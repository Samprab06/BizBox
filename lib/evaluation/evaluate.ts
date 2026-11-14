/**
 * HAC-22: site evaluation and sensitivity. Pure TypeScript and deterministic: the same
 * request (including its cached behavior tables) always gives the same result, with no
 * Jev or network calls. Persistence lives in lib/evaluation/repository.ts.
 *
 * Pipeline per site: personas + (behavior table | Huff) -> demand -> seeded arrival
 * schedule -> queue engine, for weekday and weekend over N seeds; each seed's two days
 * become one month of economics. Sites rank by mean monthly operating contribution.
 */
import {
  EVALUATION_MODEL_VERSION,
  EvaluationRequestSchema,
  type DemandSource,
  type EvaluationOverrides,
  type EvaluationRequest,
  type EvaluationRequestInput,
  type EvaluationResult,
  type EvaluationSite,
  type HourlyStat,
  type MetricSummary,
  type RepresentativeRun,
  type SensitivityAssumption,
  type SensitivityPoint,
  type SensitivityResult,
  type SiteEvaluation,
} from "@/lib/contracts/evaluation";
import type {
  BehaviorTable,
  DayType,
  DemandInput,
} from "@/lib/demand/contracts";
import { CATEGORY_DEFAULTS } from "@/lib/demand/defaults";
import {
  buildArrivalSchedule,
  demandDerivation,
  estimateDemand,
} from "@/lib/demand/model";
import type { DayResult, SimEvent, SiteConfig } from "@/lib/sim/contracts";
import { computeParsedMonthlyEconomics } from "@/lib/sim/economics";
import { percentile, simulateDay } from "@/lib/sim/engine";

const DAY_TYPES = ["weekday", "weekend"] as const satisfies readonly DayType[];
/** Two sites are tied when their 90% intervals overlap by at least this share of the narrower one. */
export const TIE_OVERLAP = 0.5;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Mean plus 5th / 50th / 95th percentiles (nearest rank). */
export function summarize(values: readonly number[]): MetricSummary {
  if (values.length === 0) return { mean: 0, low: 0, median: 0, high: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    mean,
    low: percentile(sorted, 0.05) ?? sorted[0]!,
    median: percentile(sorted, 0.5) ?? sorted[0]!,
    high: percentile(sorted, 0.95) ?? sorted[sorted.length - 1]!,
  };
}

/** Share of the narrower interval covered by the overlap of two intervals, in [0, 1]. */
export function intervalOverlap(a: MetricSummary, b: MetricSummary): number {
  const overlap = Math.min(a.high, b.high) - Math.max(a.low, b.low);
  const narrower = Math.min(a.high - a.low, b.high - b.low);
  if (narrower <= 0) {
    // A point interval: tied only if it sits inside the other interval.
    const point = a.high - a.low <= b.high - b.low ? a : b;
    const other = point === a ? b : a;
    return point.mean >= other.low && point.mean <= other.high ? 1 : 0;
  }
  return Math.max(0, overlap) / narrower;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Price acceptance at a price, linearly interpolated between the persona's asked prices. */
export function acceptanceAt(
  points: readonly { price: number; p: number }[],
  price: number,
): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.price - b.price);
  if (price <= sorted[0]!.price) return sorted[0]!.p;
  const last = sorted[sorted.length - 1]!;
  if (price >= last.price) return last.p;
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (price >= lo.price && price <= hi.price) {
      const t =
        hi.price === lo.price ? 0 : (price - lo.price) / (hi.price - lo.price);
      return lo.p + t * (hi.p - lo.p);
    }
  }
  return last.p;
}

/** Rescales each persona's visits by its cached acceptance at `price` relative to `basePrice`. */
export function repriceBehaviorTable(
  table: BehaviorTable,
  basePrice: number,
  price: number,
): BehaviorTable {
  return {
    ...table,
    personas: table.personas.map((b) => {
      const base = acceptanceAt(b.priceAcceptance, basePrice);
      const next = acceptanceAt(b.priceAcceptance, price);
      if (base === null || next === null || base <= 0) return b;
      return { ...b, visitsPerMonth: (b.visitsPerMonth * next) / base };
    }),
  };
}

/** The site's engine config after ticket, price and rent overrides. */
export function applyConfigOverrides(
  config: SiteConfig,
  o: EvaluationOverrides,
): SiteConfig {
  const ticket =
    o.priceUsd ?? config.prices.avgTicketUsd * (o.ticketMultiplier ?? 1);
  return {
    ...config,
    prices: { ...config.prices, avgTicketUsd: ticket },
    lease: {
      ...config.lease,
      askingRentUsdPerSfYear:
        config.lease.askingRentUsdPerSfYear * (o.rentMultiplier ?? 1),
    },
  };
}

function demandInputFor(
  request: EvaluationRequest,
  site: EvaluationSite,
  source: DemandSource,
): DemandInput {
  const o = request.overrides;
  const cat = CATEGORY_DEFAULTS[request.category];
  // Visits per person and market share multiply into expected visits identically
  // (weight x visits x share x scale), so both fold into the scale.
  const multiplier =
    (o.scaleMultiplier ?? 1) * (o.visitFrequencyMultiplier ?? 1);
  const scale =
    multiplier === 1
      ? undefined
      : { value: cat.scale.value * multiplier, origin: "default" as const };
  let demand: DemandInput["demand"];
  if (source === "jev") {
    if (!site.behaviorTable)
      throw new Error(`site ${site.siteId} has no behavior table`);
    const table =
      o.priceUsd === undefined
        ? site.behaviorTable
        : repriceBehaviorTable(
            site.behaviorTable,
            site.config.prices.avgTicketUsd,
            o.priceUsd,
          );
    demand = { source: "jev", behavior: table };
  } else {
    demand = { source: "huff", huff: { competitors: request.competitors } };
  }
  // The site's configured mean service time drives generated service durations, so an
  // owner's service assumption changes actual processing time (reviewer finding, HAC-60).
  const meanService = site.config.service.meanServiceMin;
  return {
    site: site.storefront,
    personaSet: request.personaSet,
    ...(meanService !== undefined
      ? {
          serviceMeanMin: {
            value: meanService,
            origin: site.serviceMeanOrigin ?? ("default" as const),
          },
        }
      : {}),
    city: request.city,
    category: request.category,
    priceTier: request.priceTier,
    demand,
    ...(scale ? { scale } : {}),
  };
}

/** Jev when every site has a cached behavior table; otherwise Huff for all sites, with the reason. */
export function resolveDemandSource(request: EvaluationRequest): {
  source: DemandSource;
  fallbackReason: string | null;
} {
  if (request.demandSource === "huff")
    return { source: "huff", fallbackReason: null };
  const missing = request.sites
    .filter((s) => !s.behaviorTable)
    .map((s) => s.siteId);
  if (missing.length === 0) return { source: "jev", fallbackReason: null };
  return {
    source: "huff",
    fallbackReason: `Jev behavior tables unavailable for ${missing.join(", ")}; all sites use the Huff fallback`,
  };
}

export function seedList(
  request: Pick<EvaluationRequest, "seeds" | "baseSeed" | "seedSet">,
): number[] {
  if (request.seedSet) return [...request.seedSet];
  return Array.from({ length: request.seeds }, (_, i) => request.baseSeed + i);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function runIdFor(
  siteId: string,
  dayType: DayType,
  seed: number,
): string {
  return `${siteId}:${dayType}:s${seed}`;
}

/** Per-hour arrivals, completions, abandonment, waits and station utilization of one day. */
export function hourlyStats(day: DayResult): HourlyStat[] {
  const { openMin, closeMin, stations } = day.metrics;
  const firstHour = Math.floor(openMin / 60);
  const lastHour = Math.ceil(closeMin / 60) - 1;
  const rows = new Map<
    number,
    {
      arrivals: number;
      served: number;
      abandoned: number;
      waits: number[];
      busy: number;
    }
  >();
  for (let h = firstHour; h <= lastHour; h++)
    rows.set(h, { arrivals: 0, served: 0, abandoned: 0, waits: [], busy: 0 });
  const row = (t: number) =>
    rows.get(Math.min(lastHour, Math.max(firstHour, Math.floor(t / 60))))!;
  const started = new Map<string, number>();

  for (const e of day.events) {
    if (e.type === "arrival") {
      row(e.timeMin).arrivals++;
      if (e.decision === "leave") row(e.timeMin).abandoned++;
    } else if (e.type === "abandonment") row(e.timeMin).abandoned++;
    else if (e.type === "service_start") {
      row(e.timeMin).waits.push(e.waitMin);
      started.set(e.customerId, e.timeMin);
    } else if (e.type === "completion") row(e.timeMin).served++;
  }
  // Busy station-minutes: each service from its start to its completion (or to close).
  const done = new Map(
    day.events
      .filter((e) => e.type === "completion")
      .map((e) => [e.customerId, e.timeMin]),
  );
  for (const [customerId, start] of started) {
    const end = Math.min(done.get(customerId) ?? closeMin, closeMin);
    for (let h = firstHour; h <= lastHour; h++) {
      const overlap = Math.min(end, (h + 1) * 60) - Math.max(start, h * 60);
      if (overlap > 0) rows.get(h)!.busy += overlap;
    }
  }
  return [...rows.entries()].map(([hour, r]) => {
    const openInHour = Math.max(
      0,
      Math.min(closeMin, (hour + 1) * 60) - Math.max(openMin, hour * 60),
    );
    const available = stations * openInHour;
    return {
      hour,
      arrivals: r.arrivals,
      served: r.served,
      abandoned: r.abandoned,
      meanWaitMin: r.waits.length
        ? r.waits.reduce((s, v) => s + v, 0) / r.waits.length
        : null,
      utilization: available > 0 ? Math.min(1, r.busy / available) : 0,
    };
  });
}

function representative(day: DayResult, runId: string): RepresentativeRun {
  return {
    runId,
    seed: day.seed,
    dayType: day.metrics.dayType,
    utilization: day.metrics.stationUtilization,
    served: day.metrics.served,
    abandoned: day.metrics.abandoned,
    meanWaitMin: day.metrics.meanWaitMin,
    hourly: hourlyStats(day),
    eventIds: day.events.map((_, i) => `${runId}:e${i}`),
  };
}

/** Everything about one site before ranking, plus its representative days (full events). */
export interface SiteOutcome {
  evaluation: Omit<SiteEvaluation, "rank" | "tiedWith">;
  representativeDays: Record<DayType, DayResult>;
}

export function evaluateSite(
  request: EvaluationRequest,
  site: EvaluationSite,
  source: DemandSource,
): SiteOutcome {
  const config = applyConfigOverrides(site.config, request.overrides);
  const demandInput = demandInputFor(request, site, source);
  const seeds = seedList(request);

  const perSeed = seeds.map((seed) => {
    const days = {} as Record<DayType, DayResult>;
    for (const dayType of DAY_TYPES) {
      const { openMin, closeMin } = config.hours[dayType];
      const schedule = buildArrivalSchedule(demandInput, {
        seed,
        dayType,
        openMin,
        closeMin,
      });
      days[dayType] = simulateDay(schedule, config);
    }
    const economics = computeParsedMonthlyEconomics(config, {
      weekday: days.weekday.metrics,
      weekend: days.weekend.metrics,
    });
    return { seed, days, economics };
  });

  const contribution = perSeed.map((r) => r.economics.operatingContributionUsd);
  const summary = summarize(contribution);
  // Representative seed: the one closest to the median contribution (lowest seed on ties).
  let rep = perSeed[0]!;
  for (const r of perSeed) {
    const d = Math.abs(r.economics.operatingContributionUsd - summary.median);
    const best = Math.abs(
      rep.economics.operatingContributionUsd - summary.median,
    );
    if (d < best) rep = r;
  }
  const weekday = perSeed.map((r) => r.days.weekday.metrics);

  return {
    evaluation: {
      siteId: site.siteId,
      demandSource: source,
      monthlyContributionUsd: summary,
      monthlyContributionAfterBuildoutUsd: summarize(
        perSeed.map((r) => r.economics.contributionUsd),
      ),
      monthlyRevenueUsd: summarize(perSeed.map((r) => r.economics.revenueUsd)),
      monthlyServedCustomers: summarize(
        perSeed.map((r) => r.economics.servedCustomers),
      ),
      weekdayMeanWaitMin: summarize(weekday.map((m) => m.meanWaitMin ?? 0)),
      weekdayAbandonmentRate: summarize(
        weekday.map((m) => (m.arrivals > 0 ? m.abandoned / m.arrivals : 0)),
      ),
      weekdayUtilization: summarize(weekday.map((m) => m.stationUtilization)),
      contributionBySeed: contribution,
      representative: {
        weekday: representative(
          rep.days.weekday,
          runIdFor(site.siteId, "weekday", rep.seed),
        ),
        weekend: representative(
          rep.days.weekend,
          runIdFor(site.siteId, "weekend", rep.seed),
        ),
      },
      excludedPersonaIds: estimateDemand(demandInput).excludedPersonaIds,
      ...(site.jevPanel ? { jevPanel: site.jevPanel } : {}),
    },
    representativeDays: rep.days,
  };
}

/** Rank by mean contribution (site ID breaks exact ties) and mark heavily overlapping intervals. */
export function rankSites(
  outcomes: readonly SiteOutcome["evaluation"][],
): SiteEvaluation[] {
  const ordered = [...outcomes].sort(
    (a, b) =>
      b.monthlyContributionUsd.mean - a.monthlyContributionUsd.mean ||
      a.siteId.localeCompare(b.siteId),
  );
  return ordered.map((site, i) => ({
    ...site,
    rank: i + 1,
    tiedWith: ordered
      .filter(
        (o) =>
          o.siteId !== site.siteId &&
          intervalOverlap(
            o.monthlyContributionUsd,
            site.monthlyContributionUsd,
          ) >= TIE_OVERLAP,
      )
      .map((o) => o.siteId),
  }));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluationRun {
  result: EvaluationResult;
  /** Representative days per site with full engine events, for site_runs and the replay. */
  representativeDays: Record<string, Record<DayType, DayResult>>;
}

export interface EvaluateOptions {
  /** Site outcomes already computed by an earlier, interrupted call (resume). */
  completed?: Record<string, SiteOutcome>;
  /** Stop starting new sites after this time (ms since epoch, per `now`). */
  deadlineAt?: number;
  now?: () => number;
  /** Called after each site finishes, so callers can save progress. */
  onSite?: (siteId: string, outcome: SiteOutcome) => void | Promise<void>;
}

export type EvaluationProgress =
  | { status: "complete"; run: EvaluationRun }
  | {
      status: "partial";
      completed: Record<string, SiteOutcome>;
      pendingSiteIds: string[];
    };

/**
 * Evaluates sites one at a time. With a deadline it may return "partial"; call again with
 * `completed` to resume without recomputing finished sites.
 */
export async function evaluateSitesResumable(
  input: EvaluationRequestInput,
  options: EvaluateOptions = {},
): Promise<EvaluationProgress> {
  const request = EvaluationRequestSchema.parse(input);
  const { source } = resolveDemandSource(request);
  const now = options.now ?? Date.now;
  const completed: Record<string, SiteOutcome> = {
    ...(options.completed ?? {}),
  };
  for (const site of request.sites) {
    if (completed[site.siteId]) continue;
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      return {
        status: "partial",
        completed,
        pendingSiteIds: request.sites
          .map((s) => s.siteId)
          .filter((id) => !completed[id]),
      };
    }
    const outcome = evaluateSite(request, site, source);
    completed[site.siteId] = outcome;
    await options.onSite?.(site.siteId, outcome);
  }
  return { status: "complete", run: assemble(request, completed) };
}

/** Evaluates every site in one go. */
export function evaluateSites(input: EvaluationRequestInput): EvaluationRun {
  const request = EvaluationRequestSchema.parse(input);
  const { source } = resolveDemandSource(request);
  const completed: Record<string, SiteOutcome> = {};
  for (const site of request.sites)
    completed[site.siteId] = evaluateSite(request, site, source);
  return assemble(request, completed);
}

function assemble(
  request: EvaluationRequest,
  completed: Record<string, SiteOutcome>,
): EvaluationRun {
  const { source, fallbackReason } = resolveDemandSource(request);
  const sites = rankSites(
    request.sites.map((s) => completed[s.siteId]!.evaluation),
  );
  const tables = request.sites.filter((s) => s.behaviorTable);
  const result: EvaluationResult = {
    modelVersion: EVALUATION_MODEL_VERSION,
    projectId: request.projectId,
    profileId: request.profileId,
    profileVersion: request.profileVersion,
    requestedDemandSource: request.demandSource,
    demandSource: source,
    fallbackReason,
    jevModelVersion:
      source === "jev"
        ? (tables[0]?.behaviorTable?.modelVersion ?? null)
        : null,
    behaviorTableIds:
      source === "jev"
        ? Object.fromEntries(
            tables.map((s) => [
              s.siteId,
              s.behaviorTableId ?? `${s.siteId}:behavior`,
            ]),
          )
        : {},
    seeds: seedList(request),
    overrides: request.overrides,
    ranking: sites.map((s) => s.siteId),
    sites,
    derivation: demandDerivation(
      {
        demandSource: source,
        // The scale is shared by all sites; founder only when the profile calibrated it.
        scale: estimateDemand(
          demandInputFor(request, request.sites[0]!, source),
        ).scale,
      },
      request.synthetic ? "default" : "public",
    ),
  };
  return {
    result,
    representativeDays: Object.fromEntries(
      request.sites.map((s) => [
        s.siteId,
        completed[s.siteId]!.representativeDays,
      ]),
    ),
  };
}

/** Whether a stored comparison predates the project's current profile version. */
export function isOutdated(
  comparison: Pick<EvaluationResult, "profileVersion">,
  currentProfileVersion: number,
): boolean {
  return comparison.profileVersion < currentProfileVersion;
}

// ---------------------------------------------------------------------------
// Sensitivity and the demand-source check
// ---------------------------------------------------------------------------

function overridesFor(
  assumption: SensitivityAssumption,
  value: number,
  base: EvaluationOverrides,
): EvaluationOverrides {
  switch (assumption) {
    case "market_share_scale":
      return { ...base, scaleMultiplier: value };
    case "visit_frequency":
      return { ...base, visitFrequencyMultiplier: value };
    case "ticket_size":
      return { ...base, ticketMultiplier: value };
    case "rent":
      return { ...base, rentMultiplier: value };
    case "price":
      return { ...base, priceUsd: value };
  }
}

/** Default price sweep: the first site's ticket at -20%..+20%. */
export function defaultPriceValues(request: EvaluationRequest): number[] {
  const base = request.sites[0]!.config.prices.avgTicketUsd;
  return [0.8, 0.9, 1, 1.1, 1.2].map((m) => Math.round(base * m * 100) / 100);
}

/**
 * Varies one assumption across `values` (all else as in the request), and reports whether
 * the top site changes and the interpolated break-even value where it first does.
 */
export function runSensitivity(
  input: EvaluationRequestInput,
  assumption: SensitivityAssumption,
  values: readonly number[],
  options: { seeds?: number } = {},
): SensitivityResult {
  const parsed = EvaluationRequestSchema.parse(input);
  const request: EvaluationRequest = options.seeds
    ? {
        ...parsed,
        seeds: options.seeds,
        // Preserve selected seed identities while honoring the caller's work limit.
        ...(parsed.seedSet
          ? { seedSet: parsed.seedSet.slice(0, options.seeds) }
          : {}),
      }
    : parsed;
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const baseline = evaluateSites(request).result;
  const baselineTop = baseline.ranking[0]!;

  const points: SensitivityPoint[] = sorted.map((value) => {
    const r = evaluateSites({
      ...request,
      overrides: overridesFor(assumption, value, request.overrides),
    }).result;
    return {
      value,
      topSiteId: r.ranking[0]!,
      ranking: r.ranking,
      meanContributionUsd: Object.fromEntries(
        r.sites.map((s) => [s.siteId, s.monthlyContributionUsd.mean]),
      ),
    };
  });

  let breakEven: SensitivityResult["breakEven"] = null;
  for (let i = 0; i < points.length - 1 && !breakEven; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.topSiteId === b.topSiteId) continue;
    const from = a.topSiteId;
    const to = b.topSiteId;
    const da = a.meanContributionUsd[from]! - a.meanContributionUsd[to]!;
    const db = b.meanContributionUsd[from]! - b.meanContributionUsd[to]!;
    const t = da === db ? 0.5 : da / (da - db);
    breakEven = {
      value: a.value + Math.min(1, Math.max(0, t)) * (b.value - a.value),
      fromSiteId: from,
      toSiteId: to,
    };
  }

  const unit = assumption === "price" ? "usd" : "multiplier";
  const topChanges = points.some((p) => p.topSiteId !== baselineTop);
  const fmt = (v: number) =>
    unit === "usd" ? `$${v.toFixed(2)}` : `${v.toFixed(2)}x`;
  const conclusion = breakEven
    ? `The top site changes from ${breakEven.fromSiteId} to ${breakEven.toSiteId} at ${assumption} ≈ ${fmt(breakEven.value)}.`
    : `${baselineTop} stays the top site for ${assumption} from ${fmt(sorted[0]!)} to ${fmt(sorted[sorted.length - 1]!)}.`;
  return {
    assumption,
    unit,
    baselineTopSiteId: baselineTop,
    points,
    topChanges,
    breakEven,
    conclusion,
  };
}

/** Reruns the request with Huff-only demand and reports whether the ranking matches. */
export function demandSourceCheck(input: EvaluationRequestInput): {
  primary: DemandSource;
  primaryRanking: string[];
  huffRanking: string[];
  rankingMatches: boolean;
  topMatches: boolean;
} {
  const primary = evaluateSites(input).result;
  const huff = evaluateSites({
    ...EvaluationRequestSchema.parse(input),
    demandSource: "huff",
  }).result;
  return {
    primary: primary.demandSource,
    primaryRanking: primary.ranking,
    huffRanking: huff.ranking,
    rankingMatches: primary.ranking.join() === huff.ranking.join(),
    topMatches: primary.ranking[0] === huff.ranking[0],
  };
}

// ---------------------------------------------------------------------------
// Orchestrator tool summary
// ---------------------------------------------------------------------------

/** get_site_run(run_id): utilization, waits and abandonment by hour, event IDs to cite. */
export function siteRunSummary(
  result: EvaluationResult,
  runId: string,
): RepresentativeRun | null {
  for (const site of result.sites) {
    for (const run of [
      site.representative.weekday,
      site.representative.weekend,
    ]) {
      if (run.runId === runId) return run;
    }
  }
  return null;
}

/** Engine events in the canonical SiteRun vocabulary (arrived/joined/served/departed/abandoned). */
export function canonicalEvents(events: readonly SimEvent[]) {
  const out: {
    customerId: string;
    minute: number;
    type: "arrived" | "joined" | "served" | "departed" | "abandoned";
  }[] = [];
  for (const e of events) {
    if (e.type === "arrival") {
      out.push({
        customerId: e.customerId,
        minute: e.timeMin,
        type: "arrived",
      });
      if (e.decision === "leave")
        out.push({
          customerId: e.customerId,
          minute: e.timeMin,
          type: "abandoned",
        });
    } else if (e.type === "queue_entry")
      out.push({ customerId: e.customerId, minute: e.timeMin, type: "joined" });
    else if (e.type === "service_start")
      out.push({ customerId: e.customerId, minute: e.timeMin, type: "served" });
    else if (e.type === "completion")
      out.push({
        customerId: e.customerId,
        minute: e.timeMin,
        type: "departed",
      });
    else
      out.push({
        customerId: e.customerId,
        minute: e.timeMin,
        type: "abandoned",
      });
  }
  return out;
}
