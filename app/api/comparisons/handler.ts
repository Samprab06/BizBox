import { z } from "zod";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { demandSourceCheck, evaluateSites } from "@/lib/evaluation/evaluate";
import { invalid, json, notFound, readJsonBody, unavailable } from "@/lib/evaluation/http";
import { buildStoredComparison, outdatedFlag, type ComparisonStore } from "@/lib/evaluation/store";

const RerunSchema = z
  .object({ projectId: z.string().min(1), rerunComparisonId: z.string().min(1) })
  .strict();
const CreateSchema = z.union([RerunSchema, EvaluationRequestSchema.and(z.object({}))]);

type Dependencies = { store: ComparisonStore; newId: () => string };

/**
 * POST /api/comparisons
 * - an EvaluationRequest: evaluates, stores and returns the comparison (plus the Huff-only
 *   ranking check when Jev demand was used);
 * - { projectId, rerunComparisonId }: reruns a stored comparison from its stored request and
 *   cached behavior tables (no Jev calls) and reports whether the metrics reproduce.
 */
export function createComparisonsHandler({ store, newId }: Dependencies) {
  return async function POST(request: Request) {
    let body: z.infer<typeof CreateSchema>;
    try {
      body = CreateSchema.parse(await readJsonBody(request));
    } catch (error) {
      return invalid("INVALID_COMPARISON", "Provide a valid evaluation request.", error);
    }

    try {
      if ("rerunComparisonId" in body) {
        const stored = await store.load(body.projectId, body.rerunComparisonId);
        if (!stored) return notFound("COMPARISON_NOT_FOUND", "No such comparison.");
        const run = evaluateSites(stored.evaluation.request);
        const id = newId();
        const record = buildStoredComparison(id, stored.evaluation.request, run);
        await store.save(record);
        const metrics = (r: typeof record) =>
          JSON.stringify(r.evaluation.result.sites.map((s) => ({ ...s, representative: undefined })));
        return json(
          {
            comparisonId: id,
            rerunOf: stored.id,
            reproduces: metrics(record) === metrics(stored),
            outdated: await outdatedFlag(store, record),
            result: record.evaluation.result,
            comparison: record.comparison,
          },
          201,
        );
      }

      const evaluationRequest = EvaluationRequestSchema.parse(body);
      const run = evaluateSites(evaluationRequest);
      const id = newId();
      const record = buildStoredComparison(id, evaluationRequest, run);
      const check = run.result.demandSource === "jev" ? demandSourceCheck(evaluationRequest) : null;
      await store.save(record);
      return json(
        {
          comparisonId: id,
          outdated: await outdatedFlag(store, record),
          result: record.evaluation.result,
          comparison: record.comparison,
          demandSourceCheck: check,
        },
        201,
      );
    } catch {
      return unavailable("COMPARISON_UNAVAILABLE", "The comparison could not be run or saved. Please try again.");
    }
  };
}

/** GET /api/comparisons/[comparisonId]?projectId=... */
export function createComparisonReadHandler({ store }: Pick<Dependencies, "store">) {
  return async function GET(request: Request, comparisonId: string) {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return invalid("INVALID_COMPARISON", "Provide projectId.", new Error("projectId is required"));
    try {
      const stored = await store.load(projectId, comparisonId);
      if (!stored) return notFound("COMPARISON_NOT_FOUND", "No such comparison.");
      return json(
        {
          comparisonId: stored.id,
          outdated: await outdatedFlag(store, stored),
          result: stored.evaluation.result,
          sensitivity: stored.evaluation.sensitivity,
          comparison: stored.comparison,
        },
        200,
      );
    } catch {
      return unavailable("COMPARISON_UNAVAILABLE", "The comparison could not be loaded. Please try again.");
    }
  };
}
