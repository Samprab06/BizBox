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
import { SiteInsightsSchema } from "./insights";
import { StationObservationsSchema } from "./station-experiment";

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

/** Scene 1: the guided flow compares at most this many units side by side. */
export const MAX_COMPARE_UNITS = 3;

/**
 * Scene 1: per-site changes the founder (or the consultant) applies before a rerun. Each
 * field replaces that one site's engine/economics input; absent fields keep the profile's
 * value. Hours use minutes of the modeled day, like the profile's operatingHours.
 */
export const SiteTweaksSchema = z
  .object({
    hours: z
      .object({
        openMinute: z.number().int().min(0).max(1439),
        closeMinute: z.number().int().min(1).max(1440),
      })
      .strict()
      .refine((h) => h.closeMinute > h.openMinute, {
        path: ["closeMinute"],
        message: "Close must follow open within the modeled day",
      })
      .optional(),
    /** Average ticket in USD at this site. */
    priceUsd: z.number().positive().finite().max(10_000).optional(),
    /** People on the clock for every open hour at this site. */
    staff: z.number().int().min(0).max(200).optional(),
    /** Monthly base rent in USD for this site (e.g. a negotiated rent). */
    monthlyRentUsd: z
      .number()
      .nonnegative()
      .finite()
      .max(10_000_000)
      .optional(),
  })
  .strict();
export type SiteTweaks = z.infer<typeof SiteTweaksSchema>;

/** Candidate ID (`"<propertyId>:<unitId>"`) -> its tweaks. */
export const SiteTweakMapSchema = z
  .record(z.string().min(1).max(100), SiteTweaksSchema)
  .refine((map) => Object.keys(map).length <= MAX_EVALUATION_SITES, {
    message: `At most ${MAX_EVALUATION_SITES} sites can carry tweaks`,
  });
export type SiteTweakMap = z.infer<typeof SiteTweakMapSchema>;

/**
 * How many panel personas Jev answered for one site (HAC-101). Optional everywhere so stored
 * requests and results from before it existed still parse.
 */
export const JevPanelCoverageSchema = z
  .object({
    personaCount: z.number().int().nonnegative(),
    /** Personas still unanswered after the panel's retry; any here means the site uses Huff. */
    failedPersonaCount: z.number().int().nonnegative(),
  })
  .strict();
export type JevPanelCoverage = z.infer<typeof JevPanelCoverageSchema>;

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
    /**
     * HAC-159: the personas Jev was asked about for this site, built from this site's own
     * catchment so they do not depend on the other candidates. Jev demand uses them instead of
     * the shared `personaSet`, which stays the population for Huff. Absent on requests from
     * before HAC-159, which used the shared set for Jev too.
     */
    jevPersonaSet: PersonaSet.optional(),
    /** Panel coverage when Jev was asked for this site (HAC-101); carried to the result. */
    jevPanel: JevPanelCoverageSchema.optional(),
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
  })
  .refine(
    (s) => {
      if (!s.behaviorTable || !s.jevPersonaSet) return true;
      const ids = new Set(s.jevPersonaSet.personas.map((p) => p.id));
      return s.behaviorTable.personas.every((p) => ids.has(p.personaId));
    },
    {
      path: ["behaviorTable", "personas"],
      message:
        "behavior table personas must belong to the site's Jev persona set",
    },
  );
export type EvaluationSite = z.infer<typeof EvaluationSiteSchema>;

/**
 * The personas behind a site's demand: its own Jev persona set (HAC-159) when Jev answered
 * for it, otherwise the request's shared study-area personas (Huff, and older requests).
 */
export function demandPersonaSet(
  request: Pick<EvaluationRequest, "personaSet">,
  site: Pick<EvaluationSite, "jevPersonaSet">,
  source: DemandSource,
): PersonaSet {
  return source === "jev" && site.jevPersonaSet
    ? site.jevPersonaSet
    : request.personaSet;
}

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
    /** Exact scenario seeds; absent retains the historical seeds/baseSeed range. */
    seedSet: z
      .array(z.number().int().nonnegative())
      .min(1)
      .max(100)
      .refine(
        (values) => new Set(values).size === values.length,
        "Seeds must be unique",
      )
      .optional(),
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

export const SiteEvaluationSchema = z
  .object({
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
    /** HAC-94: all-seed hourly visualization data; absent on legacy comparisons. */
    insights: SiteInsightsSchema.optional(),
    /** Actual helper points, retained without per-seed schedules/events; absent on legacy data. */
    stationObservations: StationObservationsSchema.optional(),
    /** Jev panel coverage, when Jev was asked; optional for older results. */
    jevPanel: JevPanelCoverageSchema.optional(),
  })
  .superRefine((site, ctx) => {
    if (site.insights && site.insights.siteId !== site.siteId)
      ctx.addIssue({
        code: "custom",
        path: ["insights", "siteId"],
        message: "Insights must belong to the evaluation site",
      });
    if (
      site.stationObservations &&
      site.stationObservations.siteId !== site.siteId
    )
      ctx.addIssue({
        code: "custom",
        path: ["stationObservations", "siteId"],
        message: "Station observations must belong to the evaluation site",
      });
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

/** HAC-62: how robust the recommendation is (headline of a comparison). */
export const RobustnessSummarySchema = z.object({
  headline: z.string().min(1),
  leaderSiteId: z.string().min(1),
  tiedSiteIds: z.array(z.string()),
  mostInfluential: z
    .object({
      assumption: z.string(),
      breakEven: z.number().finite(),
      unit: z.enum(["multiplier", "usd"]),
      /** |break-even − current| / current: how far the assumption must move to flip the lead. */
      relativeDistance: z.number().nonnegative(),
      fromSiteId: z.string(),
      toSiteId: z.string(),
    })
    .nullable(),
  /** Assumptions whose tested range never changed the leader. */
  robustTo: z.array(z.string()),
  jevHuffAgree: z.boolean().nullable(),
  missingInformation: z.array(z.string()),
});
export type RobustnessSummary = z.infer<typeof RobustnessSummarySchema>;
