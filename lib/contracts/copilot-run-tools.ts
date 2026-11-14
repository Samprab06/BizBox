import { z } from "zod";

const id = z.string().trim().min(1).max(200);

/** Human approval, budget overrides and project identity are never model arguments. */
export const CopilotRunScenarioSchema = z
  .object({ scenario_id: id, execution_id: id.optional() })
  .strict();

export const CopilotRunReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scenario_execution"),
      scenarioId: id,
      executionId: id,
    })
    .strict(),
  z.object({ kind: z.literal("comparison"), comparisonId: id }).strict(),
]);

export const CopilotRunResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("needs_confirmation"),
      reason: z.enum(["human_run", "project_budget"]),
      scenarioId: id,
    })
    .strict(),
  ...(["queued", "running", "succeeded", "failed"] as const).map((status) =>
    z
      .object({
        status: z.literal(status),
        scenarioId: id,
        executionId: id,
        comparisonId: id.nullable(),
        references: z.array(CopilotRunReferenceSchema),
      })
      .strict(),
  ),
  z
    .object({
      status: z.literal("rejected"),
      code: z.enum(["INVALID_INPUT", "NOT_FOUND", "UNAVAILABLE"]),
      message: z.string(),
    })
    .strict(),
]);

export type CopilotRunResult = z.infer<typeof CopilotRunResultSchema>;
