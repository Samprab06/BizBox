import { z } from "zod";
import { DEFAULT_SENSITIVITY_VALUES, SensitivityRequestSchema } from "@/lib/contracts/evaluation";
import { defaultPriceValues, runSensitivity } from "@/lib/evaluation/evaluate";
import { invalid, json, notFound, readJsonBody, unavailable } from "@/lib/evaluation/http";
import { withSensitivity, type ComparisonStore } from "@/lib/evaluation/store";

const BodySchema = SensitivityRequestSchema.extend({
  projectId: z.string().min(1),
  values: SensitivityRequestSchema.shape.values.optional(),
}).strict();

/**
 * POST /api/comparisons/[comparisonId]/sensitivity
 * Body: { projectId, assumption, values?, seeds? }. Varies one assumption over `values`
 * (defaults per assumption; rent ±10%), stores the result on the comparison, returns it.
 */
export function createSensitivityHandler({ store }: { store: ComparisonStore }) {
  return async function POST(request: Request, comparisonId: string) {
    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await readJsonBody(request, 64 * 1024));
    } catch (error) {
      return invalid("INVALID_SENSITIVITY", "Provide an assumption and values.", error);
    }
    try {
      const stored = await store.load(body.projectId, comparisonId);
      if (!stored) return notFound("COMPARISON_NOT_FOUND", "No such comparison.");
      const req = stored.evaluation.request;
      const values =
        body.values ??
        (body.assumption === "price" ? defaultPriceValues(req) : DEFAULT_SENSITIVITY_VALUES[body.assumption]);
      const result = runSensitivity(req, body.assumption, values, body.seeds ? { seeds: body.seeds } : {});
      const updated = withSensitivity(stored, result);
      await store.saveSensitivity(body.projectId, comparisonId, updated);
      return json({ comparisonId, sensitivity: result, comparison: updated.comparison }, 200);
    } catch {
      return unavailable("SENSITIVITY_UNAVAILABLE", "The sensitivity run could not be completed. Please try again.");
    }
  };
}
