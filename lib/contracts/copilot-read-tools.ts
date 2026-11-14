import { z } from "zod";
import { ScenarioValueReferenceSchema } from "./copilot-tools";

const id = z.string().trim().min(1).max(200);
const hour = z.number().int().min(0).max(23);
/** Trusted loader receipt from an existing succeeded scenario execution, not a model argument. */
export const CopilotComparisonBindingSchema = z
  .object({
    projectId: id,
    scenarioId: id,
    comparisonId: id,
    executionId: id,
  })
  .strict();
export const CopilotSearchPreferencesSchema = z
  .object({
    minSizeSqFt: z.number().finite().positive().optional(),
    maxSizeSqFt: z.number().finite().positive().optional(),
    limit: z.number().int().min(1).max(8).optional(),
    near: z.string().trim().min(1).max(500).optional(),
    area: z.string().trim().min(1).max(500).optional(),
    rentCeilingCents: z.number().int().positive().max(1_000_000_000).optional(),
    mustHaves: z
      .object({
        frontage: z.boolean().optional(),
        corner: z.boolean().optional(),
        parking: z.boolean().optional(),
        groundFloor: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.minSizeSqFt === undefined ||
      v.maxSizeSqFt === undefined ||
      v.minSizeSqFt <= v.maxSizeSqFt,
  );
export type CopilotSearchPreferences = z.infer<
  typeof CopilotSearchPreferencesSchema
>;
export const CopilotReadSchemas = {
  find_sites: z
    .object({
      scenario_id: id,
      preferences: CopilotSearchPreferencesSchema.default({}),
    })
    .strict(),
  compare_scenarios: z.object({ a: id, b: id }).strict(),
  explain_hour: z
    .object({
      run_id: id,
      hour,
      day: z.enum(["weekday", "weekend"]).optional(),
    })
    .strict(),
  diagnose: z.object({ scenario_id: id }).strict(),
  focus_view: z
    .object({
      scenario_id: id,
      view: z.enum(["overview", "comparison", "replay"]),
      site_id: id.optional(),
      run_id: id.optional(),
      hour: hour.optional(),
    })
    .strict()
    .refine(
      (v) => v.view !== "replay" || v.run_id !== undefined,
      "Replay requires a run",
    )
    .refine(
      (v) => v.hour === undefined || v.run_id !== undefined,
      "Hour requires a run",
    ),
};
export type CopilotReadToolName = keyof typeof CopilotReadSchemas;
export type CopilotFocusInput = z.infer<typeof CopilotReadSchemas.focus_view>;

export const ComparisonMetricSchema = z.enum([
  "monthlyContributionUsd",
  "monthlyContributionAfterBuildoutUsd",
  "monthlyRevenueUsd",
  "monthlyServedCustomers",
  "weekdayMeanWaitMin",
  "weekdayAbandonmentRate",
  "weekdayUtilization",
]);
export const HourMetricSchema = z.enum([
  "arrivals",
  "served",
  "abandoned",
  "meanWaitMin",
  "utilization",
]);
export const ComparisonMetricReferenceSchema = z
  .object({
    kind: z.literal("comparison_metric"),
    comparisonId: id,
    siteId: id,
    metric: ComparisonMetricSchema,
    statistic: z.enum(["low", "mean", "median", "high"]),
  })
  .strict();
/** A resolver computes B minus A; interval bounds are not claims of paired-seed confidence. */
export const ComparisonDeltaReferenceSchema = z
  .object({
    kind: z.literal("comparison_delta"),
    comparisonIdA: id,
    comparisonIdB: id,
    siteId: id,
    metric: ComparisonMetricSchema,
    statistic: z.enum(["low", "mean", "median", "high"]),
  })
  .strict();
export const HourMetricReferenceSchema = z
  .object({
    kind: z.literal("hour_metric"),
    runId: id,
    hour,
    metric: HourMetricSchema,
  })
  .strict();
export const CandidateReferenceSchema = z
  .object({
    kind: z.literal("candidate"),
    projectId: id,
    scenarioId: id,
    siteId: id,
    evidenceIds: z.array(id).min(1),
  })
  .strict();
export const CopilotReadReferenceSchema = z.union([
  ScenarioValueReferenceSchema,
  ComparisonMetricReferenceSchema,
  ComparisonDeltaReferenceSchema,
  HourMetricReferenceSchema,
  CandidateReferenceSchema,
]);
const warnings = z.array(
  z.enum([
    "UNMATCHED_SITES",
    "REPRESENTATIVE_RUN_ONLY",
    "NO_CANDIDATES",
    "INTERVAL_DELTAS_NOT_PAIRED_CONFIDENCE",
    "MISSING_HOURLY_WAIT",
  ]),
);
export const CopilotReadResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("found"),
      scenarioId: id,
      siteIds: z.array(id),
      references: z.array(CandidateReferenceSchema),
      warnings,
    })
    .strict(),
  z
    .object({
      status: z.literal("compared"),
      scenarioIdA: id,
      scenarioIdB: id,
      comparisonIdA: id,
      comparisonIdB: id,
      rankingChanged: z.boolean(),
      unmatchedSiteIdsA: z.array(id),
      unmatchedSiteIdsB: z.array(id),
      references: z.array(
        z.union([
          ScenarioValueReferenceSchema,
          ComparisonMetricReferenceSchema,
          ComparisonDeltaReferenceSchema,
        ]),
      ),
      warnings,
    })
    .strict(),
  z
    .object({
      status: z.literal("explained"),
      scenarioId: id,
      comparisonId: id,
      runId: id,
      siteId: id,
      hour,
      day: z.enum(["weekday", "weekend"]),
      references: z.array(HourMetricReferenceSchema),
      warnings,
    })
    .strict(),
  z
    .object({
      status: z.literal("delegated"),
      scenarioId: id,
      actionId: id,
      warnings,
    })
    .strict(),
  z
    .object({
      status: z.literal("unsupported"),
      code: z.enum([
        "ADAPTER_UNAVAILABLE",
        "NEAR_SEARCH_UNAVAILABLE",
        "HOUR_UNAVAILABLE",
      ]),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      code: z.enum([
        "INVALID_INPUT",
        "NOT_FOUND",
        "SCOPE_CONFLICT",
        "STALE_CONTEXT",
        "UNAVAILABLE",
      ]),
      message: z.string(),
    })
    .strict(),
]);
export type CopilotReadResult = z.infer<typeof CopilotReadResultSchema>;
