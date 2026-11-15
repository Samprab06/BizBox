import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  EvaluationRequestSchema,
  type EvaluationRequest,
} from "@/lib/contracts/evaluation";
import { demandSourceCheck, evaluateSites } from "@/lib/evaluation/evaluate";
import {
  invalid,
  json,
  notFound,
  readJsonBody,
  unavailable,
} from "@/lib/evaluation/http";
import {
  buildStoredComparison,
  outdatedFlag,
  withSensitivity,
  type ComparisonStore,
} from "@/lib/evaluation/store";
import {
  autoSensitivities,
  robustnessSummary,
} from "@/lib/evaluation/robustness";

import {
  AssemblyError,
  PanelInProgressError,
  AssemblyShortcutSchema,
  type AssembleEvaluationInput,
  type AssembledEvaluation,
  type AssemblyMetadata,
  type PanelDeadline,
} from "@/lib/evaluation/assemble";
import type { PanelInProgressBody } from "@/lib/panel/progress";
import type { ProfileStore } from "@/lib/profiles/store";

const RerunSchema = z
  .object({
    projectId: z.string().min(1),
    rerunComparisonId: z.string().min(1),
  })
  .strict();
const CreateSchema = z.union([
  RerunSchema,
  AssemblyShortcutSchema,
  EvaluationRequestSchema.and(z.object({})),
]);

type Dependencies = {
  store: ComparisonStore;
  newId: () => string;
  profiles?: Pick<ProfileStore, "load">;
  assemble?: (
    input: AssembleEvaluationInput,
    deadline?: PanelDeadline,
  ) => Promise<AssembledEvaluation>;
  /** Time the Jev panel may use per request (HAC-155); the rest of maxDuration (60 s) evaluates and saves. */
  panelBudgetMs?: number;
  now?: () => number;
};

/** Leaves about 25 s of the 60 s function for evaluation, sweeps and the save. */
export const COMPARISON_PANEL_BUDGET_MS = 35_000;

/**
 * POST /api/comparisons
 * - { projectId, profileId, candidateIds, demandSource?, seeds? }: assembles a saved profile
 *   with current source data, retaining origins/findings alongside the stored evaluation;
 * - an EvaluationRequest: evaluates, stores and returns the comparison (plus the Huff-only
 *   ranking check when Jev demand was used);
 *   a Jev assembly that reaches the panel deadline returns 202
 *   { status: "in_progress", message, completedPersonas, totalPersonas } (HAC-155): nothing is
 *   stored yet, and resending the same body resumes from the Jev answer cache;
 * - { projectId, rerunComparisonId }: reruns a stored comparison from its stored request and
 *   cached behavior tables (no Jev calls) and reports whether the metrics reproduce.
 */
export function createComparisonsHandler({
  store,
  newId,
  profiles,
  assemble,
  panelBudgetMs = COMPARISON_PANEL_BUDGET_MS,
  now = Date.now,
}: Dependencies) {
  return async function POST(request: Request) {
    const deadlineAt = now() + panelBudgetMs;
    let body: z.infer<typeof CreateSchema>;
    try {
      body = CreateSchema.parse(await readJsonBody(request));
    } catch (error) {
      return invalid(
        "INVALID_COMPARISON",
        "Provide a valid evaluation request.",
        error,
      );
    }

    try {
      if ("rerunComparisonId" in body) {
        const stored = await store.load(body.projectId, body.rerunComparisonId);
        if (!stored)
          return notFound("COMPARISON_NOT_FOUND", "No such comparison.");
        const run = evaluateSites(stored.evaluation.request);
        const id = newId();
        let record = buildStoredComparison(id, stored.evaluation.request, run);
        if (stored.evaluation.assembly)
          record.evaluation.assembly = stored.evaluation.assembly;
        // Deterministic: the stored sweeps and summary still describe the rerun.
        for (const sweep of stored.evaluation.sensitivity)
          record = withSensitivity(record, sweep);
        if (stored.evaluation.robustness)
          record.evaluation.robustness = stored.evaluation.robustness;
        await store.save(record);
        const metrics = (r: typeof record) =>
          r.evaluation.result.sites.map((s) => ({
            ...s,
            representative: undefined,
            // Additive visualization data was not retained by legacy evaluations.
            insights: undefined,
            stationObservations: undefined,
          }));
        return json(
          {
            comparisonId: id,
            rerunOf: stored.id,
            // JSONB may reorder object keys; compare metric values, not key order.
            reproduces: isDeepStrictEqual(metrics(record), metrics(stored)),
            outdated: await outdatedFlag(store, record),
            result: record.evaluation.result,
            comparison: record.comparison,
            robustness: record.evaluation.robustness ?? null,
            ...(record.evaluation.assembly
              ? { assembly: record.evaluation.assembly }
              : {}),
          },
          201,
        );
      }

      let evaluationRequest: EvaluationRequest;
      let assembly: AssemblyMetadata | undefined;
      if ("candidateIds" in body) {
        const shortcut = AssemblyShortcutSchema.parse(body);
        if (!profiles || !assemble)
          return unavailable(
            "ASSEMBLY_UNAVAILABLE",
            "Site assembly is unavailable. Please try again.",
          );
        const profile = await profiles.load(
          shortcut.projectId,
          shortcut.profileId,
        );
        if (!profile)
          return notFound(
            "PROFILE_NOT_FOUND",
            "No such profile in this project.",
          );
        const assembled = await assemble(
          {
            ...shortcut,
            profile,
            profileVersion: profile.version,
          },
          { deadlineAt, now },
        );
        evaluationRequest = EvaluationRequestSchema.parse(assembled.request);
        assembly = {
          findings: assembled.findings,
          assumptions: assembled.assumptions,
          ...(assembled.jevCompetitorSet
            ? { jevCompetitorSet: assembled.jevCompetitorSet }
            : {}),
        };
      } else evaluationRequest = EvaluationRequestSchema.parse(body);
      const run = evaluateSites(evaluationRequest);
      const id = newId();
      let record = buildStoredComparison(id, evaluationRequest, run);
      if (assembly) record.evaluation.assembly = assembly;
      const check =
        run.result.demandSource === "jev"
          ? demandSourceCheck(evaluationRequest)
          : null;
      // HAC-62: automatic sweeps feed the robustness headline and are stored as sensitivity.
      const sweeps = autoSensitivities(evaluationRequest);
      for (const sweep of sweeps) record = withSensitivity(record, sweep);
      record.evaluation.robustness = robustnessSummary({
        request: evaluationRequest,
        result: record.evaluation.result,
        sensitivities: sweeps,
        demandSourceCheck: check,
        ...(assembly
          ? { findings: assembly.findings, assumptions: assembly.assumptions }
          : {}),
      });
      await store.save(record);
      return json(
        {
          comparisonId: id,
          outdated: await outdatedFlag(store, record),
          result: record.evaluation.result,
          comparison: record.comparison,
          demandSourceCheck: check,
          robustness: record.evaluation.robustness,
          ...(assembly ? { assembly } : {}),
        },
        201,
      );
    } catch (error) {
      if (error instanceof PanelInProgressError)
        return json(
          {
            status: "in_progress",
            message: error.message,
            completedPersonas: error.completedPersonas,
            totalPersonas: error.totalPersonas,
          } satisfies PanelInProgressBody,
          202,
        );
      if (error instanceof AssemblyError)
        return json(
          {
            code: "ASSEMBLY_INVALID",
            message: "The requested sites could not be assembled.",
            findings: error.findings,
            field_errors: {},
          },
          422,
        );
      return unavailable(
        "COMPARISON_UNAVAILABLE",
        "The comparison could not be run or saved. Please try again.",
      );
    }
  };
}

/** GET /api/comparisons/[comparisonId]?projectId=... */
export function createComparisonReadHandler({
  store,
}: Pick<Dependencies, "store">) {
  return async function GET(request: Request, comparisonId: string) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId)
      return invalid(
        "INVALID_COMPARISON",
        "Provide projectId.",
        new Error("projectId is required"),
      );
    try {
      const stored = await store.load(projectId, comparisonId);
      if (!stored)
        return notFound("COMPARISON_NOT_FOUND", "No such comparison.");
      return json(
        {
          comparisonId: stored.id,
          outdated: await outdatedFlag(store, stored),
          result: stored.evaluation.result,
          sensitivity: stored.evaluation.sensitivity,
          robustness: stored.evaluation.robustness ?? null,
          comparison: stored.comparison,
          ...(stored.evaluation.assembly
            ? { assembly: stored.evaluation.assembly }
            : {}),
        },
        200,
      );
    } catch {
      return unavailable(
        "COMPARISON_UNAVAILABLE",
        "The comparison could not be loaded. Please try again.",
      );
    }
  };
}
