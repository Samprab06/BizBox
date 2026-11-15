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
/** HAC-89: one segment's modeled choice share for one store (the site or a competitor). */
export const SegmentShareReferenceSchema = z
  .object({
    kind: z.literal("segment_share"),
    comparisonId: id,
    siteId: id,
    segment: id,
    storeId: id,
  })
  .strict();
export const CopilotReadReferenceSchema = z.union([
  ScenarioValueReferenceSchema,
  ComparisonMetricReferenceSchema,
  ComparisonDeltaReferenceSchema,
  HourMetricReferenceSchema,
  CandidateReferenceSchema,
  SegmentShareReferenceSchema,
]);
const warnings = z.array(
  z.enum([
    "UNMATCHED_SITES",
    "REPRESENTATIVE_RUN_ONLY",
    "NO_CANDIDATES",
    "INTERVAL_DELTAS_NOT_PAIRED_CONFIDENCE",
    "MISSING_HOURLY_WAIT",
    "HUFF_FALLBACK_DEMAND",
    "NO_BOTTLENECK_FOUND",
  ]),
);

// ---------------------------------------------------------------------------
// HAC-89: post-run bottleneck diagnosis and proposed experiments
// ---------------------------------------------------------------------------

export const BottleneckSchema = z.enum([
  "demand_limited",
  "capacity_limited",
  "rent_limited",
  "competitor_leakage",
]);
export type Bottleneck = z.infer<typeof BottleneckSchema>;

/** Local-clock hours [startHour, endHour) of one saved representative run. */
export const DiagnosisHourBlockSchema = z
  .object({
    day: z.enum(["weekday", "weekend"]),
    runId: id,
    startHour: hour,
    endHour: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((b) => b.endHour > b.startHour, "End hour must follow start hour");
export type DiagnosisHourBlock = z.infer<typeof DiagnosisHourBlockSchema>;

export const DiagnosisReferenceSchema = z.union([
  ComparisonMetricReferenceSchema,
  HourMetricReferenceSchema,
  SegmentShareReferenceSchema,
]);

/** A finding never carries numeric prose: values resolve through its references. */
export const DiagnosisFindingSchema = z
  .object({
    id,
    siteId: id,
    bottleneck: BottleneckSchema,
    comparisonId: id,
    runIds: z.array(id).min(1),
    hourBlocks: z.array(DiagnosisHourBlockSchema).min(1),
    segment: id.optional(),
    competitorId: id.optional(),
    summary: z.string().trim().min(1).max(500),
    references: z.array(DiagnosisReferenceSchema).min(1),
  })
  .strict();
export type DiagnosisFinding = z.infer<typeof DiagnosisFindingSchema>;

export const DiagnosisExperimentSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(200),
    findingIds: z.array(id).min(1),
    /** An existing copilot tool; mutations become proposals, never runs. */
    tool: z.enum(["set_stations", "set_hours", "find_sites"]),
    args: z.record(z.string(), z.json()),
    expectedEffect: z
      .object({
        siteId: id,
        metric: ComparisonMetricSchema,
        direction: z.enum(["decrease", "increase"]),
      })
      .strict(),
    /** True when the human must choose Run before any result exists. */
    requiresRun: z.boolean(),
  })
  .strict();
export type DiagnosisExperiment = z.infer<typeof DiagnosisExperimentSchema>;

/** A human-approved experiment's saved result against the diagnosed baseline. */
export const ExperimentDiffCardSchema = z
  .object({
    /** Null when the child matches no proposed experiment (for example a manual edit). */
    experimentId: id.nullable(),
    baseScenarioId: id,
    experimentScenarioId: id,
    baseComparisonId: id,
    experimentComparisonId: id,
    siteId: id,
    metric: ComparisonMetricSchema,
    direction: z.enum(["decrease", "increase"]),
    verdict: z.enum(["improved", "worse", "no_change"]),
    winner: z.boolean(),
    references: z.array(ComparisonDeltaReferenceSchema).min(1),
  })
  .strict();
export type ExperimentDiffCard = z.infer<typeof ExperimentDiffCardSchema>;
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
      status: z.literal("diagnosed"),
      scenarioId: id,
      comparisonId: id,
      demandSource: z.enum(["jev", "huff"]),
      findings: z.array(DiagnosisFindingSchema).max(40),
      experiments: z.array(DiagnosisExperimentSchema).max(3),
      /** Present when this scenario's parent has a verified saved comparison. */
      experimentCard: ExperimentDiffCardSchema.optional(),
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
