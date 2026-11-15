import { createHash } from "node:crypto";
import { z } from "zod";
import { LayoutInputError } from "@/lib/layout";
import {
  AssemblyError,
  PanelInProgressError,
  type PanelDeadline,
} from "@/lib/evaluation/assemble";
import type { PanelProgressCount } from "@/lib/panel/progress";
import {
  DEFAULT_SEEDS,
  EVALUATION_MODEL_VERSION,
  EvaluationRequestSchema,
  type DemandSource,
} from "@/lib/contracts/evaluation";
import type { Scenario } from "@/lib/contracts/scenario";
import type { AssembledEvaluation } from "@/lib/evaluation/assemble";
import { evaluateSitesResumable, seedList } from "@/lib/evaluation/evaluate";
import {
  buildStoredComparison,
  type ComparisonStore,
} from "@/lib/evaluation/store";
import type { ScenarioRepository } from "./repository";
import { parseScenario } from "./model";
import {
  ScenarioRunError,
  type ScenarioExecution,
  type ScenarioExecutionStore,
} from "./run-store";

export const DEFAULT_SCENARIO_RUN_BUDGET_UNITS = 1200;
/** Time kept after a deadline-limited Jev panel (HAC-155) to checkpoint the execution. */
export const SCENARIO_PANEL_RESERVE_MS = 5_000;
export const StartScenarioRunSchema = z
  .object({
    confirm: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    demandSource: z.enum(["huff", "jev"]).default("huff"),
  })
  .strict();
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
export function scenarioExecutionKey(
  scenario: Scenario,
  demandSource: DemandSource,
  artifactVersion: string | null = "hac102-v1",
) {
  return createHash("sha256")
    .update(
      canonical({
        model: EVALUATION_MODEL_VERSION,
        assembly: "hac81-scenario-v1",
        ...(artifactVersion ? { stationObservations: artifactVersion } : {}),
        projectId: scenario.projectId,
        profileVersion: scenario.profileVersion,
        siteIds: scenario.siteIds,
        overrides: scenario.overrides,
        layoutId: scenario.layoutId,
        demandSource,
      }),
    )
    .digest("hex");
}
function publicExecution(e: ScenarioExecution, panel?: PanelProgressCount) {
  return {
    ...(panel ? { panel } : {}),
    status: e.status,
    runId: e.id,
    scenarioId: e.scenarioId,
    comparisonId: e.comparisonId,
    runIds: e.runIds,
    cached: e.cached,
    costUnits: e.costUnits,
    completedSiteIds: Object.keys(e.completed),
  };
}
export function createScenarioRunner({
  scenarios,
  executions,
  comparisons,
  prepare,
  newId,
  now = () => new Date(),
  budgetUnits = DEFAULT_SCENARIO_RUN_BUDGET_UNITS,
  evaluate = evaluateSitesResumable,
}: {
  scenarios: Pick<ScenarioRepository, "get">;
  executions: ScenarioExecutionStore;
  comparisons: ComparisonStore;
  prepare: (
    scenario: Scenario,
    demandSource: DemandSource,
    deadline?: PanelDeadline,
  ) => Promise<AssembledEvaluation>;
  newId: () => string;
  now?: () => Date;
  budgetUnits?: number;
  evaluate?: typeof evaluateSitesResumable;
}) {
  z.number().int().nonnegative().max(10_000_000).parse(budgetUnits);
  async function scenario(projectId: string, id: string) {
    const value = await scenarios.get(projectId, id);
    if (!value) throw new ScenarioRunError("not_found", "Scenario not found");
    return parseScenario(value);
  }
  async function read(projectId: string, scenarioId: string, runId: string) {
    const job = await executions.get(projectId, runId);
    if (!job || job.scenarioId !== scenarioId)
      throw new ScenarioRunError("not_found", "Scenario execution not found");
    return job;
  }
  async function advance(
    projectId: string,
    scenarioId: string,
    runId: string,
    maxMs = 45_000,
  ) {
    const existing = await read(projectId, scenarioId, runId);
    if (existing.status === "succeeded" || existing.status === "failed")
      return publicExecution(existing);
    const token = newId();
    let job = await executions.acquire(
      projectId,
      runId,
      token,
      now(),
      maxMs + 30_000,
    );
    if (!job)
      throw new ScenarioRunError(
        "busy",
        "Scenario execution is already being advanced",
      );
    const deadlineAt = now().getTime() + maxMs;
    const save = async (next: ScenarioExecution) => {
      job = await executions.save(next, token, now());
      return job;
    };
    try {
      const value = await scenario(projectId, scenarioId);
      if (!job.request) {
        // Reservation precedes assembly (and any opt-in Jev calls) or simulation.
        const source =
          job.effectiveKey === scenarioExecutionKey(value, "jev") ||
          job.effectiveKey === scenarioExecutionKey(value, "jev", null)
            ? "jev"
            : "huff";
        let assembled: AssembledEvaluation;
        try {
          assembled = await prepare(value, source, {
            deadlineAt: deadlineAt - SCENARIO_PANEL_RESERVE_MS,
            now: () => now().getTime(),
          });
        } catch (error) {
          // HAC-155: the Jev panel hit its deadline. Its answers are cached by key, so the
          // next advance prepares the same scenario again and resumes from them (still queued).
          if (error instanceof PanelInProgressError)
            return publicExecution(job, {
              completedPersonas: error.completedPersonas,
              totalPersonas: error.totalPersonas,
            });
          throw error;
        }
        const request = EvaluationRequestSchema.parse(assembled.request);
        const actualSites = request.sites.map((s) => s.siteId).sort();
        const expectedSeeds =
          value.overrides.seedSet?.value ??
          Array.from({ length: DEFAULT_SEEDS }, (_, i) => i + 1);
        if (
          request.projectId !== projectId ||
          request.profileVersion !== value.profileVersion ||
          canonical(actualSites) !== canonical(value.siteIds) ||
          canonical(seedList(request)) !== canonical(expectedSeeds) ||
          seedList(request).length * actualSites.length * 2 !== job.costUnits
        )
          throw new ScenarioRunError(
            "invalid",
            "Prepared evaluation does not match the reserved scenario",
          );
        await save({
          ...job,
          status: "running",
          request,
          assembly: {
            findings: assembled.findings,
            assumptions: assembled.assumptions,
            ...(assembled.jevCompetitorSet
              ? { jevCompetitorSet: assembled.jevCompetitorSet }
              : {}),
            ...(assembled.scenario ? { scenario: assembled.scenario } : {}),
          },
        });
      }
      if (!job.request)
        throw new ScenarioRunError("invalid", "Execution request unavailable");
      const comparisonId = `${job.id}:comparison`;
      let record = await comparisons.load(projectId, comparisonId);
      if (!record) {
        const progress = await evaluate(job.request, {
          completed: job.completed,
          deadlineAt,
          now: () => now().getTime(),
          onSite: async (siteId, outcome) => {
            await save({
              ...job!,
              completed: { ...job!.completed, [siteId]: outcome },
            });
          },
        });
        if (progress.status === "partial") return publicExecution(job);
        record = buildStoredComparison(comparisonId, job.request, progress.run);
        if (job.assembly) record.evaluation.assembly = job.assembly;
        try {
          await comparisons.save(record);
        } catch (error) {
          // Crash after a successful comparison write must not duplicate it on resume.
          const saved = await comparisons.load(projectId, comparisonId);
          if (!saved) throw error;
          record = saved;
        }
      }
      await save({
        ...job,
        status: "succeeded",
        comparisonId: record.id,
        runIds: record.runs.map((r) => r.id),
      });
      return publicExecution(job);
    } catch (error) {
      // Transient dependency/storage failures retain checkpoints for a later advance.
      if (
        job &&
        (error instanceof LayoutInputError ||
          error instanceof AssemblyError ||
          error instanceof z.ZodError ||
          (error instanceof ScenarioRunError &&
            (error.code === "invalid" || error.code === "not_found")))
      )
        await save({ ...job, status: "failed" });
      throw error;
    } finally {
      await executions.release(projectId, runId, token);
    }
  }
  return {
    async start(projectId: string, scenarioId: string, raw: unknown) {
      const input = StartScenarioRunSchema.parse(raw);
      const value = await scenario(projectId, scenarioId);
      const id = newId();
      const effectiveKey = scenarioExecutionKey(value, input.demandSource);
      const reservation = await executions.reserve({
        id,
        projectId,
        scenarioId,
        idempotencyKey: input.idempotencyKey ?? effectiveKey,
        effectiveKey,
        costUnits:
          value.siteIds.length *
          (value.overrides.seedSet?.value.length ?? DEFAULT_SEEDS) *
          2,
        budgetUnits,
        confirm: input.confirm,
        now: now(),
      });
      if (reservation.status === "needs_confirmation") return reservation;
      try {
        return await advance(projectId, scenarioId, reservation.execution.id);
      } catch (error) {
        if (error instanceof ScenarioRunError && error.code === "busy")
          return publicExecution(
            await read(projectId, scenarioId, reservation.execution.id),
          );
        throw error;
      }
    },
    advance,
    async get(projectId: string, scenarioId: string, runId: string) {
      return publicExecution(await read(projectId, scenarioId, runId));
    },
  };
}
export type ScenarioRunner = ReturnType<typeof createScenarioRunner>;
