import { z } from "zod";
import {
  BehaviorTable,
  Category,
  City,
  PersonaSet,
  PriceTier,
  Storefront,
} from "@/lib/demand/contracts";
import { SiteConfigSchema } from "@/lib/sim/contracts";

/**
 * HAC-22: site evaluation and sensitivity. One evaluation runs every site through
 * demand -> arrival schedule -> queue engine over N seeds for weekday and weekend,
 * then turns each seed pair into monthly economics.
 */

export const DEMAND_SOURCES = ["jev", "huff"] as const;
export const DemandSourceSchema = z.enum(DEMAND_SOURCES);
export type DemandSource = z.infer<typeof DemandSourceSchema>;

export const MAX_EVALUATION_SITES = 8;
export const DEFAULT_SEEDS = 30;

export const EvaluationSiteSchema = z
  .object({
    siteId: z.string().min(1),
    /** Demand-model view of the space (location, size, position, frontage, anchors). */
    storefront: Storefront,
    /** Engine and economics inputs for this space (hours, stations, prices, lease...). */
    config: SiteConfigSchema,
    /** Cached Jev answers for this site. Without one, the site cannot use demandSource "jev". */
    behaviorTable: BehaviorTable.optional(),
    behaviorTableId: z.string().min(1).optional(),
    /** Origin of config.service.meanServiceMin (founder when the profile states it). */
    serviceMeanOrigin: z
      .enum(["costar", "public", "founder", "default"])
      .optional(),
  })
  .strict()
  .refine((s) => s.storefront.id === s.siteId, {
    path: ["storefront", "id"],
    message: "storefront.id must equal siteId",
  })
  .refine((s) => !s.behaviorTable || s.behaviorTable.siteId === s.siteId, {
    path: ["behaviorTable", "siteId"],
    message: "behavior table must be for this site",
  });
export type EvaluationSite = z.infer<typeof EvaluationSiteSchema>;

/** One-at-a-time changes applied to every site. Multipliers default to 1. */
export const EvaluationOverridesSchema = z
  .object({
    /** Market-share scale multiplier on each site's demand. */
    scaleMultiplier: z.number().positive().finite().optional(),
    /** Visits per person per month multiplier. */
    visitFrequencyMultiplier: z.number().positive().finite().optional(),
    /** Average ticket multiplier (revenue per served customer), demand unchanged. */
    ticketMultiplier: z.number().positive().finite().optional(),
    /** Asking rent multiplier. */
    rentMultiplier: z.number().positive().finite().optional(),
    /**
     * Absolute price in USD. Sets the ticket and, with Jev demand, rescales each
     * persona's visits by its cached price acceptance relative to the base price.
     */
    priceUsd: z.number().positive().finite().optional(),
  })
  .strict();
export type EvaluationOverrides = z.infer<typeof EvaluationOverridesSchema>;

export const EvaluationRequestSchema = z
  .object({
    projectId: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.number().int().positive(),
    /** True when the inputs are fixtures rather than sourced data. */
    synthetic: z.boolean().default(false),
    city: City,
    category: Category,
    priceTier: PriceTier,
    personaSet: PersonaSet,
    competitors: z.array(Storefront).default([]),
    sites: z
      .array(EvaluationSiteSchema)
      .min(1)
      .max(MAX_EVALUATION_SITES)
      .refine(
        (sites) => new Set(sites.map((s) => s.siteId)).size === sites.length,
        "Site IDs must be unique",
      ),
    demandSource: DemandSourceSchema.default("jev"),
    seeds: z.number().int().min(1).max(100).default(DEFAULT_SEEDS),
    baseSeed: z.number().int().nonnegative().default(1),
    overrides: EvaluationOverridesSchema.default({}),
  })
  .strict();
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;
export type EvaluationRequestInput = z.input<typeof EvaluationRequestSchema>;

/** Mean and the 90% interval (5th to 95th percentile) over seeds. */
export const MetricSummarySchema = z.object({
  mean: z.number().finite(),
  low: z.number().finite(),
  median: z.number().finite(),
  high: z.number().finite(),
});
export type MetricSummary = z.infer<typeof MetricSummarySchema>;

export const HourlyStatSchema = z.object({
  hour: z.number().int().min(0).max(23),
  arrivals: z.number().int().nonnegative(),
  served: z.number().int().nonnegative(),
  abandoned: z.number().int().nonnegative(),
  meanWaitMin: z.number().nonnegative().nullable(),
  /** Busy station-minutes / available station-minutes in that hour. */
  utilization: z.number().min(0).max(1),
});
export type HourlyStat = z.infer<typeof HourlyStatSchema>;

export const RepresentativeRunSchema = z.object({
  runId: z.string().min(1),
  seed: z.number().int().nonnegative(),
  dayType: z.enum(["weekday", "weekend"]),
  utilization: z.number().min(0).max(1),
  served: z.number().int().nonnegative(),
  abandoned: z.number().int().nonnegative(),
  meanWaitMin: z.number().nonnegative().nullable(),
  hourly: z.array(HourlyStatSchema),
  /** Event IDs (`<runId>:e<index>`) that a plan can cite. */
  eventIds: z.array(z.string().min(1)),
});
export type RepresentativeRun = z.infer<typeof RepresentativeRunSchema>;

export const SiteEvaluationSchema = z.object({
  siteId: z.string().min(1),
  rank: z.number().int().positive(),
  /** Sites whose contribution intervals overlap this one's heavily: not a meaningful difference. */
  tiedWith: z.array(z.string().min(1)),
  demandSource: DemandSourceSchema,
  /** Operating contribution per month (revenue minus COGS, labor, rent, opex), USD. */
  monthlyContributionUsd: MetricSummarySchema,
  /** The same after buildout amortization, USD. */
  monthlyContributionAfterBuildoutUsd: MetricSummarySchema,
  monthlyRevenueUsd: MetricSummarySchema,
  monthlyServedCustomers: MetricSummarySchema,
  weekdayMeanWaitMin: MetricSummarySchema,
  weekdayAbandonmentRate: MetricSummarySchema,
  weekdayUtilization: MetricSummarySchema,
  /** Per-seed operating contribution, in seed order. Kept so ties and reruns are checkable. */
  contributionBySeed: z.array(z.number().finite()),
  representative: z.object({
    weekday: RepresentativeRunSchema,
    weekend: RepresentativeRunSchema,
  }),
  excludedPersonaIds: z.array(z.string()),
});
export type SiteEvaluation = z.infer<typeof SiteEvaluationSchema>;

export const EVALUATION_MODEL_VERSION = "hac-22-evaluation-1";

export const EvaluationResultSchema = z.object({
  modelVersion: z.literal(EVALUATION_MODEL_VERSION),
  projectId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  requestedDemandSource: DemandSourceSchema,
  demandSource: DemandSourceSchema,
  /** Why Jev was not used, when it was requested. */
  fallbackReason: z.string().min(1).nullable(),
  jevModelVersion: z.string().nullable(),
  behaviorTableIds: z.record(z.string(), z.string()),
  seeds: z.array(z.number().int().nonnegative()),
  overrides: EvaluationOverridesSchema,
  /** Site IDs, best first, by mean monthly contribution. */
  ranking: z.array(z.string().min(1)),
  sites: z.array(SiteEvaluationSchema),
  /**
   * How the demand numbers were produced (HAC-61): inputs → synthetic personas → behavioural
   * model → calibration → modelled arrivals. Optional so comparisons stored earlier still parse.
   */
  derivation: z
    .object({
      inputs: z.enum(["public", "default"]),
      transformation: z.literal("synthetic_personas"),
      behaviorModel: DemandSourceSchema,
      calibration: z.enum(["none", "founder"]),
      output: z.literal("modelled_arrivals"),
    })
    .optional(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const SENSITIVITY_ASSUMPTIONS = [
  "market_share_scale",
  "visit_frequency",
  "ticket_size",
  "rent",
  "price",
] as const;
export const SensitivityAssumptionSchema = z.enum(SENSITIVITY_ASSUMPTIONS);
export type SensitivityAssumption = z.infer<typeof SensitivityAssumptionSchema>;

export const SensitivityPointSchema = z.object({
  value: z.number().finite(),
  topSiteId: z.string().min(1),
  ranking: z.array(z.string().min(1)),
  meanContributionUsd: z.record(z.string(), z.number().finite()),
});
export type SensitivityPoint = z.infer<typeof SensitivityPointSchema>;

export const SensitivityResultSchema = z.object({
  assumption: SensitivityAssumptionSchema,
  /** Multiplier for scale/frequency/ticket/rent; USD for price. */
  unit: z.enum(["multiplier", "usd"]),
  baselineTopSiteId: z.string().min(1),
  points: z.array(SensitivityPointSchema).min(1),
  topChanges: z.boolean(),
  /**
   * Interpolated value where the top site first changes (linear between the two
   * tested values that bracket the change), or null when it never changes.
   */
  breakEven: z
    .object({
      value: z.number().finite(),
      fromSiteId: z.string().min(1),
      toSiteId: z.string().min(1),
    })
    .nullable(),
  conclusion: z.string().min(1),
});
export type SensitivityResult = z.infer<typeof SensitivityResultSchema>;

export const SensitivityRequestSchema = z
  .object({
    assumption: SensitivityAssumptionSchema,
    values: z.array(z.number().positive().finite()).min(1).max(12),
    /** Fewer seeds keep sweeps fast; defaults to the comparison's own seed count. */
    seeds: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type SensitivityRequest = z.infer<typeof SensitivityRequestSchema>;

/** Default sweep per assumption (rent is ±10% as the ticket asks). */
export const DEFAULT_SENSITIVITY_VALUES: Record<
  SensitivityAssumption,
  number[]
> = {
  market_share_scale: [0.5, 0.75, 1, 1.25, 1.5],
  visit_frequency: [0.5, 0.75, 1, 1.25, 1.5],
  ticket_size: [0.8, 0.9, 1, 1.1, 1.2],
  rent: [0.9, 0.95, 1, 1.05, 1.1],
  price: [],
};
