import type {
  DemandSource,
  EvaluationResult,
  MetricSummary,
  SiteEvaluation,
  SiteTweakMap,
  SiteTweaks,
} from "@/lib/contracts/evaluation";
import {
  FinalPlanSummarySchema,
  GroundedLocationPlanSchema,
  type FinalPlanSummary,
  type GroundedLocationPlan,
} from "@/lib/contracts/plan";

/**
 * Scene 1, final step: turns the finalized comparison (and its grounded /plan, when it
 * loaded) into the `FinalPlanSummary` the "Final plan" view shows and the flow store keeps.
 * Everything here is pure except `fetchGroundedPlan`.
 */

export type SummaryRange =
  FinalPlanSummary["metrics"]["monthlyServedCustomers"];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const countFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCentsFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const minutesFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** `-0` would print as "-0", so it is folded to 0 first. */
const clean = (n: number) => (Object.is(Math.round(n), -0) ? 0 : n);

/** Whole customers, e.g. `1,240`. */
export const formatCount = (n: number) => countFormat.format(clean(n));
/** Whole US dollars, e.g. `$12,400` or `-$800`. */
export const formatUsd = (n: number) => usdFormat.format(clean(n));
/** Dollars and cents, for prices, e.g. `$6.50`. */
export const formatUsdCents = (n: number) => usdCentsFormat.format(n);
/** Minutes with one decimal, e.g. `4.2 min`. */
export const formatMinutes = (n: number) =>
  `${minutesFormat.format(Math.max(0, n))} min`;

/** `low–high` with the given number format. */
export const formatRange = (
  range: Pick<SummaryRange, "low" | "high">,
  format: (n: number) => string,
) => `${format(range.low)}–${format(range.high)}`;

/** Minute of the modeled day as a 12-hour `h:mm AM` clock; 1440 is midnight. */
export function formatClock(minuteOfDay: number): string {
  const minute = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minute / 60);
  const mm = String(minute % 60).padStart(2, "0");
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${mm} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** The finalized date, e.g. `Nov 15, 2026, 2:30 PM`; the raw string when unparseable. */
export function formatFinalizedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export type TweakLine = {
  key: keyof SiteTweaks;
  label: string;
  value: string;
};

/** The applied tweaks, in a fixed order, as display lines. Empty when there are none. */
export function describeTweaks(tweaks: SiteTweaks | undefined): TweakLine[] {
  if (!tweaks) return [];
  const lines: TweakLine[] = [];
  if (tweaks.hours)
    lines.push({
      key: "hours",
      label: "Hours",
      value: `${formatClock(tweaks.hours.openMinute)}–${formatClock(tweaks.hours.closeMinute)}`,
    });
  if (tweaks.priceUsd !== undefined)
    lines.push({
      key: "priceUsd",
      label: "Average ticket",
      value: formatUsdCents(tweaks.priceUsd),
    });
  if (tweaks.staff !== undefined)
    lines.push({
      key: "staff",
      label: "Staff",
      value: `${formatCount(tweaks.staff)} ${tweaks.staff === 1 ? "person" : "people"} per open hour`,
    });
  if (tweaks.monthlyRentUsd !== undefined)
    lines.push({
      key: "monthlyRentUsd",
      label: "Rent",
      value: `${formatUsd(tweaks.monthlyRentUsd)} / month`,
    });
  return lines;
}

export const demandSourceLabel = (source: DemandSource) =>
  source === "jev" ? "Jev customer panel" : "Huff gravity fallback";

export type RunnerUpGap = {
  /** Chosen minus runner-up mean monthly contribution, USD. */
  difference: number;
  /** True when the two contribution ranges overlap (the lead is not clear-cut). */
  overlapping: boolean;
};

/** How the chosen site's contribution compares with the runner-up's; null without one. */
export function runnerUpGap(
  summary: Pick<FinalPlanSummary, "metrics" | "runnerUp">,
): RunnerUpGap | null {
  if (!summary.runnerUp) return null;
  const chosen = summary.metrics.monthlyContributionUsd;
  const other = summary.runnerUp.monthlyContributionUsd;
  return {
    difference: chosen.mean - other.mean,
    overlapping: chosen.low <= other.high && other.low <= chosen.high,
  };
}

/** Signed USD per month, e.g. `+$1,200` or `-$300`. */
export const formatUsdDelta = (n: number) =>
  `${n > 0 ? "+" : ""}${formatUsd(n)}`;

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** The summary keeps mean, low and high only (no median), with low <= high. */
export function toSummaryRange(
  metric: Pick<MetricSummary, "mean" | "low" | "high">,
): SummaryRange {
  return {
    mean: metric.mean,
    low: Math.min(metric.low, metric.high),
    high: Math.max(metric.low, metric.high),
  };
}

/** A range is "wide" when high/low reaches this ratio (both positive). */
export const WIDE_RANGE_RATIO = 1.5;
/** A weekday mean wait above this many minutes is flagged. */
export const LONG_WAIT_MEAN_MIN = 8;
/** A weekday wait whose high end reaches this many minutes is flagged. */
export const LONG_WAIT_HIGH_MIN = 15;

/**
 * Whether a modeled range is wide enough to warn about. With a positive low end the test is
 * high/low >= `ratio`; when the range touches or crosses zero (contribution can), the spread
 * is compared with the mean instead (spread >= |mean|).
 */
export function isWideRange(
  range: Pick<SummaryRange, "mean" | "low" | "high">,
  ratio = WIDE_RANGE_RATIO,
): boolean {
  const low = Math.min(range.low, range.high);
  const high = Math.max(range.low, range.high);
  if (high === low) return false;
  if (low > 0) return high / low >= ratio;
  if (range.mean === 0) return true;
  return high - low >= Math.abs(range.mean);
}

/** Drops plan citations such as ` [comparison:abc]` and collapses whitespace. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[(?:comparison|run|evidence):[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** The best ranked site other than `chosenSiteId`, or null when there is none. */
export function pickRunnerUp(
  result: Pick<EvaluationResult, "ranking" | "sites">,
  chosenSiteId: string,
): SiteEvaluation | null {
  const byId = new Map(result.sites.map((site) => [site.siteId, site]));
  for (const id of result.ranking) {
    if (id === chosenSiteId) continue;
    const site = byId.get(id);
    if (site) return site;
  }
  // Sites missing from the ranking still count, best rank first.
  const rest = result.sites
    .filter(
      (site) =>
        site.siteId !== chosenSiteId && !result.ranking.includes(site.siteId),
    )
    .sort((a, b) => a.rank - b.rank);
  return rest[0] ?? null;
}

export type RiskInput = {
  site: Pick<
    SiteEvaluation,
    | "siteId"
    | "demandSource"
    | "monthlyServedCustomers"
    | "monthlyContributionUsd"
    | "weekdayMeanWaitMin"
    | "tiedWith"
  >;
  result: Pick<EvaluationResult, "requestedDemandSource" | "fallbackReason">;
  plan?: GroundedLocationPlan | null;
  /** Address lookup for tie messages. */
  addresses?: Record<string, string>;
};

export const MAX_RISKS = 8;

/** Plain-language risks for the chosen site, most important first, at most `MAX_RISKS`. */
export function deriveRisks({
  site,
  result,
  plan,
  addresses = {},
}: RiskInput): string[] {
  const risks: string[] = [];
  const contribution = toSummaryRange(site.monthlyContributionUsd);
  const customers = toSummaryRange(site.monthlyServedCustomers);
  const wait = toSummaryRange(site.weekdayMeanWaitMin);

  if (contribution.mean < 0)
    risks.push(
      `The modeled operating contribution is negative on average (${formatUsd(contribution.mean)} a month); the site loses money under these assumptions.`,
    );
  else if (contribution.low < 0)
    risks.push(
      `In weaker modeled scenarios the site loses money: contribution falls as low as ${formatUsd(contribution.low)} a month.`,
    );

  if (site.demandSource === "huff") {
    const reason =
      result.requestedDemandSource === "jev" && result.fallbackReason
        ? ` (${stripCitations(result.fallbackReason)})`
        : "";
    risks.push(
      `Demand comes from the Huff gravity fallback, not the Jev customer panel${reason}. Treat the customer range as rougher.`,
    );
  }

  if (isWideRange(customers))
    risks.push(
      `The customer estimate is wide (${formatRange(customers, formatCount)} a month), so actual traffic could land well away from the mean.`,
    );
  if (isWideRange(contribution))
    risks.push(
      `The contribution range is wide (${formatRange(contribution, formatUsd)} a month); small changes in traffic or costs move it a lot.`,
    );

  if (wait.mean > LONG_WAIT_MEAN_MIN || wait.high >= LONG_WAIT_HIGH_MIN)
    risks.push(
      `Weekday waits run long (${formatMinutes(wait.mean)} on average, up to ${formatMinutes(wait.high)}); customers may walk away at peak hours.`,
    );

  if (plan) {
    if (plan.status === "no_site_meets_budget")
      risks.push(
        "No compared site clears every budget ceiling you gave; negotiate rent or buildout, or revise the concept, before signing.",
      );
    else if (plan.status === "budget_unknown")
      risks.push(
        "Your budget is unknown, so the ranking is provisional; confirm rent and buildout limits before committing.",
      );
    else if (plan.status === "tie" && plan.tiedSiteIds.includes(site.siteId)) {
      const others = plan.tiedSiteIds
        .filter((id) => id !== site.siteId)
        .map((id) => addresses[id] ?? "another compared site");
      risks.push(
        `The modeled result is effectively tied with ${others.join(" and ") || "another compared site"}; the difference is within the ranges.`,
      );
    } else if (
      plan.status === "recommended" &&
      plan.plan.recommendedSiteId &&
      plan.plan.recommendedSiteId !== site.siteId
    )
      risks.push(
        `This is not the site the budget check recommends (${addresses[plan.plan.recommendedSiteId] ?? "another compared site"}); make sure the trade-off is deliberate.`,
      );
  } else if (site.tiedWith.length > 0) {
    const others = site.tiedWith.map(
      (id) => addresses[id] ?? "another compared site",
    );
    risks.push(
      `The modeled result overlaps heavily with ${others.join(" and ")}; the ranking difference is not meaningful.`,
    );
  }

  return risks.slice(0, MAX_RISKS).map((risk) => clip(risk, 500));
}

export const MAX_NEXT_STEPS = 8;

/** Next steps when the grounded plan is unavailable. */
export function defaultNextSteps(tweaks?: SiteTweaks): string[] {
  const rent =
    tweaks?.monthlyRentUsd !== undefined
      ? ` of ${formatUsd(tweaks.monthlyRentUsd)} a month`
      : "";
  const hours = tweaks?.hours
    ? ` (${formatClock(tweaks.hours.openMinute)}–${formatClock(tweaks.hours.closeMinute)})`
    : "";
  const staff =
    tweaks?.staff !== undefined
      ? ` with ${formatCount(tweaks.staff)} on the clock`
      : "";
  return [
    "Tour the unit in person during your planned busiest hours; confirm frontage, access, condition and what buildout it needs.",
    `Negotiate the lease toward the modeled rent target${rent}, and get the full occupancy costs (NNN, CAM, escalations) in writing.`,
    `Validate the opening hours${hours} and staffing${staff} assumptions against local hiring and comparable shops.`,
    "Count real foot traffic on a few typical weekdays and compare it with the modeled customer range before signing.",
  ];
}

/** The plan's next steps without citations, or the defaults when there is no plan. */
export function deriveNextSteps(
  plan: GroundedLocationPlan | null | undefined,
  tweaks?: SiteTweaks,
): string[] {
  const fromPlan = (plan?.plan.nextSteps ?? [])
    .map(stripCitations)
    .filter((step) => step.length > 0);
  const steps = fromPlan.length > 0 ? fromPlan : defaultNextSteps(tweaks);
  return steps.slice(0, MAX_NEXT_STEPS).map((step) => clip(step, 500));
}

const nonEmptyTweaks = (tweaks: SiteTweaks | undefined) =>
  tweaks && Object.keys(tweaks).length > 0 ? tweaks : undefined;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type BuildFinalPlanSummaryInput = {
  projectId: string;
  comparisonId: string;
  chosenSiteId: string;
  /** The consultant's `finalize_plan` rationale ("why this site"). */
  rationale: string;
  result: EvaluationResult;
  /** siteId -> display address for every compared site. */
  addresses: Record<string, string>;
  /** The flow store's per-site tweaks; only the chosen site's are kept. */
  tweaks?: SiteTweakMap;
  /** The grounded plan from `fetchGroundedPlan`, when it loaded. */
  plan?: GroundedLocationPlan | null;
  /** Finalization time; defaults to now. */
  now?: Date;
};

export const DEFAULT_RATIONALE =
  "Chosen with your consultant after comparing the modeled ranges for each location.";

/**
 * Builds the validated final-plan summary. Throws when `chosenSiteId` is not one of the
 * comparison's sites, or when the output would not satisfy `FinalPlanSummarySchema`.
 */
export function buildFinalPlanSummary({
  projectId,
  comparisonId,
  chosenSiteId,
  rationale,
  result,
  addresses,
  tweaks,
  plan,
  now = new Date(),
}: BuildFinalPlanSummaryInput): FinalPlanSummary {
  const site = result.sites.find((entry) => entry.siteId === chosenSiteId);
  if (!site)
    throw new Error(
      `Chosen site ${chosenSiteId} is not part of comparison ${comparisonId}`,
    );
  const address = (id: string, fallback: string) =>
    clip(addresses[id]?.trim() || fallback, 300);
  const runner = pickRunnerUp(result, chosenSiteId);
  const chosenTweaks = nonEmptyTweaks(tweaks?.[chosenSiteId]);
  const why = clip(rationale.trim() || DEFAULT_RATIONALE, 2000);

  return FinalPlanSummarySchema.parse({
    projectId,
    comparisonId,
    chosenSiteId,
    chosenAddress: address(chosenSiteId, "Selected location"),
    rationale: why,
    finalizedAt: now.toISOString(),
    demandSource: site.demandSource,
    metrics: {
      monthlyServedCustomers: toSummaryRange(site.monthlyServedCustomers),
      monthlyContributionUsd: toSummaryRange(site.monthlyContributionUsd),
      weekdayMeanWaitMin: toSummaryRange(site.weekdayMeanWaitMin),
    },
    ...(chosenTweaks ? { tweaks: chosenTweaks } : {}),
    runnerUp: runner
      ? {
          siteId: runner.siteId,
          address: address(runner.siteId, "Runner-up location"),
          monthlyContributionUsd: toSummaryRange(runner.monthlyContributionUsd),
        }
      : null,
    risks: deriveRisks({ site, result, plan, addresses }),
    nextSteps: deriveNextSteps(plan, chosenTweaks),
  });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type FetchGroundedPlanOptions = {
  /** Required by the route: the plan is scoped to the project. */
  projectId: string;
  signal?: AbortSignal;
  investigationId?: string;
  /** For tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

/** The URL of `GET /api/comparisons/<id>/plan` for one project. */
export function groundedPlanUrl(
  comparisonId: string,
  projectId: string,
  investigationId?: string,
): string {
  const query = new URLSearchParams({ projectId });
  if (investigationId) query.set("investigationId", investigationId);
  return `/api/comparisons/${encodeURIComponent(comparisonId)}/plan?${query}`;
}

/**
 * Loads the comparison's grounded plan. Returns null on any failure (network, abort,
 * non-2xx or an unexpected body), so the summary falls back to its own defaults.
 */
export async function fetchGroundedPlan(
  comparisonId: string,
  {
    projectId,
    signal,
    investigationId,
    fetchImpl = globalThis.fetch,
  }: FetchGroundedPlanOptions,
): Promise<GroundedLocationPlan | null> {
  try {
    const response = await fetchImpl(
      groundedPlanUrl(comparisonId, projectId, investigationId),
      { signal, cache: "no-store" },
    );
    if (!response.ok) return null;
    const parsed = GroundedLocationPlanSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
