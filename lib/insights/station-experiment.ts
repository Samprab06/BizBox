import { summarize as summarizeValues } from "@/lib/evaluation/evaluate";
import { experimentDelta, type ExperimentResult } from "@/lib/sim/experiment";
import {
  ArrivalScheduleSchema,
  DayTypeSchema,
  OriginSchema,
  SiteConfigSchema,
  type Origin,
  type SiteConfig,
  type DayType,
} from "@/lib/sim/contracts";
import { resolveStationCount } from "@/lib/sim/engine";
import { computeMonthlyEconomics } from "@/lib/sim/economics";

export type StationExperimentInput = {
  baseline: readonly ExperimentResult[];
  alternatives: readonly { id: string; results: readonly ExperimentResult[] }[];
  origins: readonly Origin[];
};
import {
  StationExperimentCalloutSchema,
  type StationExperimentCallout,
} from "@/lib/contracts/station-experiment";
export type { StationExperimentCallout } from "@/lib/contracts/station-experiment";
type Dependencies = {
  delta?: typeof experimentDelta;
  summarize?: typeof summarizeValues;
};
const days = ["weekday", "weekend"] as const;
function fail(reason: string): never {
  throw new RangeError(`Incomparable station experiments: ${reason}`);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const same = (left: unknown, right: unknown) =>
  canonical(left) === canonical(right);
function parameters(result: ExperimentResult, day: DayType) {
  return Object.fromEntries(
    Object.entries(result.schedules[day].params).map(([key, metric]) => [
      key,
      metric.value,
    ]),
  );
}
function settingSignature(
  result: ExperimentResult,
  allowStationChange: boolean,
) {
  const {
    plannedStations,
    staffHeadcount,
    averageTicketUsd,
    demandMultiplier,
    hours,
    dayType,
  } = result.settings;
  const settings = { averageTicketUsd, demandMultiplier, hours, dayType };
  const { stations, staff, ...config } = result.config;
  const { planned, ...stationArea } = stations;
  const { headcount, ...staffCosts } = staff;
  return {
    settings,
    config,
    stationArea,
    staffCosts,
    ...(allowStationChange
      ? {}
      : { plannedStations, staffHeadcount, planned, headcount }),
    siteId: result.selected.siteId,
    demand: days.map((day) => ({
      params: parameters(result, day),
      source: result.schedules[day].demandSource,
      curves: result.schedules[day].stayCurves,
    })),
  };
}
function workload(result: ExperimentResult, day: DayType) {
  const schedule = result.schedules[day];
  return {
    siteId: schedule.siteId,
    seed: schedule.seed,
    dayType: schedule.dayType,
    openMin: schedule.openMin,
    closeMin: schedule.closeMin,
    // Inputs to queue decisions, never the decisions, waits or service starts.
    customers: [...schedule.customers].sort((a, b) => a.id.localeCompare(b.id)),
    stayCurves: schedule.stayCurves,
    params: parameters(result, day),
    source: schedule.demandSource,
  };
}
function validateRun(result: ExperimentResult) {
  if (
    !result ||
    typeof result !== "object" ||
    !result.settings ||
    !result.selected ||
    !result.days ||
    !result.schedules ||
    !result.monthly?.costs
  )
    fail("completed helper results are required, not marginal ranges");
  const settings = result.settings;
  if (!Number.isSafeInteger(settings.seed) || settings.seed < 0)
    fail("known unique seeds are required");
  const parsed = SiteConfigSchema.safeParse(result.config);
  if (!parsed.success || !DayTypeSchema.safeParse(settings.dayType).success)
    fail("invalid helper configuration");
  const config = parsed.data;
  if (
    !finite(settings.averageTicketUsd) ||
    settings.averageTicketUsd <= 0 ||
    !finite(settings.demandMultiplier) ||
    settings.demandMultiplier <= 0 ||
    settings.averageTicketUsd !== config.prices.avgTicketUsd ||
    settings.plannedStations !== config.stations.planned ||
    settings.staffHeadcount !== config.staff.headcount ||
    !same(settings.hours, config.hours)
  )
    fail("settings disagree with helper configuration");
  const siteId = result.selected.siteId;
  if (typeof siteId !== "string" || !siteId)
    fail("known site identity is required");
  for (const day of days) {
    const schedule = ArrivalScheduleSchema.safeParse(result.schedules[day]);
    const output = result.days[day];
    if (!schedule.success || !output?.metrics)
      fail("complete weekday and weekend observations are required");
    const m = output.metrics;
    if (
      schedule.data.seed !== settings.seed ||
      schedule.data.dayType !== day ||
      schedule.data.siteId !== siteId ||
      output.seed !== settings.seed ||
      output.siteId !== siteId ||
      m.dayType !== day ||
      schedule.data.openMin !== config.hours[day].openMin ||
      schedule.data.closeMin !== config.hours[day].closeMin ||
      m.openMin !== config.hours[day].openMin ||
      m.closeMin !== config.hours[day].closeMin ||
      m.stations !== resolveStationCount(config)
    )
      fail("seed, site, day or resolved station identity mismatch");
    for (const count of [m.balked, m.reneged, m.abandoned])
      if (!Number.isSafeInteger(count) || count < 0)
        fail("invalid walk-away observations");
    if (
      m.abandoned !== m.balked + m.reneged ||
      !finite(m.revenueUsd) ||
      !finite(m.served)
    )
      fail("invalid day observations");
    if (
      Object.values(schedule.data.params).some(
        (metric) => !finite(metric.value),
      )
    )
      fail("non-finite workload parameters");
  }
  const selected = result.days[settings.dayType];
  if (
    result.selected.seed !== settings.seed ||
    !same(result.selected.metrics, selected.metrics)
  )
    fail("selected day does not match helper days");
  const expected = computeMonthlyEconomics(config, {
    weekday: result.days.weekday.metrics,
    weekend: result.days.weekend.metrics,
  });
  for (const value of [
    result.monthly.revenueUsd,
    result.monthly.contributionUsd,
    result.monthly.costs.staffHours,
  ])
    if (!finite(value)) fail("finite helper point estimates are required");
  if (
    expected.revenueUsd !== result.monthly.revenueUsd ||
    expected.contributionUsd !== result.monthly.contributionUsd ||
    expected.costs.staffHours !== result.monthly.costs.staffHours
  )
    fail("monthly point estimates disagree with the helper days");
}
function indexResults(results: readonly ExperimentResult[]) {
  if (!Array.isArray(results))
    fail("completed seed observations are required, not marginal ranges");
  const indexed = new Map<number, ExperimentResult>();
  for (const result of results) {
    validateRun(result);
    if (indexed.has(result.settings.seed)) fail("duplicate seed observations");
    indexed.set(result.settings.seed, result);
  }
  const first = results[0];
  if (
    first &&
    results.some(
      (result) =>
        !same(settingSignature(first, false), settingSignature(result, false)),
    )
  )
    fail("seed observations must share one baseline or alternative setting");
  return indexed;
}
const calendarDays = (config: SiteConfig, day: DayType) =>
  day === "weekday"
    ? config.calendar.weekdayDaysPerMonth
    : config.calendar.weekendDaysPerMonth;
function monthlyWalkAways(result: ExperimentResult) {
  return days.reduce(
    (sum, day) =>
      sum +
      (result.days[day].metrics.balked + result.days[day].metrics.reneged) *
        calendarDays(result.config, day),
    0,
  );
}
function stationHours(result: ExperimentResult) {
  return days.reduce(
    (sum, day) =>
      sum +
      ((result.days[day].metrics.stations *
        (result.config.hours[day].closeMin -
          result.config.hours[day].openMin)) /
        60) *
        calendarDays(result.config, day),
    0,
  );
}

/** Completed results only: no simulation/provider calls, scheduling or recommendation objective. */
export function summarizeStationExperiments(
  input: StationExperimentInput,
  dependencies: Dependencies = {},
): StationExperimentCallout[] {
  if (
    !input ||
    !Array.isArray(input.alternatives) ||
    !Array.isArray(input.origins) ||
    !input.origins.length ||
    input.origins.some((origin) => !OriginSchema.safeParse(origin).success)
  )
    fail("explicit known input origins and alternatives are required");
  const baseline = indexResults(input.baseline);
  const seeds = [...baseline.keys()].sort((a, b) => a - b);
  const delta = dependencies.delta ?? experimentDelta;
  const aggregate = dependencies.summarize ?? summarizeValues;
  const ids = new Set<string>();
  const variants: StationExperimentCallout[] = [];
  for (const candidate of input.alternatives) {
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      ids.has(candidate.id)
    )
      fail("alternative identifiers must be nonempty and unique");
    ids.add(candidate.id);
    const alternative = indexResults(candidate.results);
    if (
      alternative.size !== baseline.size ||
      seeds.some((seed) => !alternative.has(seed))
    )
      fail("baseline and alternative need the same paired seeds");
    for (const seed of seeds) {
      const b = baseline.get(seed)!,
        a = alternative.get(seed)!;
      if (
        !same(settingSignature(b, true), settingSignature(a, true)) ||
        days.some((day) => !same(workload(b, day), workload(a, day)))
      )
        fail(
          "only whole-day station and staff counts may change for the same workload",
        );
    }
    if (seeds.length < 2) continue;
    const first = baseline.get(seeds[0]!)!,
      next = alternative.get(seeds[0]!)!;
    const revenue: number[] = [],
      contribution: number[] = [],
      monthlyWalk: number[] = [],
      selectedWalk: number[] = [];
    for (const seed of seeds) {
      const b = baseline.get(seed)!,
        a = alternative.get(seed)!;
      const change = delta(b, a);
      revenue.push(a.monthly.revenueUsd - b.monthly.revenueUsd);
      contribution.push(change.monthlyContributionUsd);
      monthlyWalk.push(monthlyWalkAways(a) - monthlyWalkAways(b));
      selectedWalk.push(change.walkAways);
    }
    if (
      [...revenue, ...contribution, ...monthlyWalk, ...selectedWalk].some(
        (value) => !finite(value),
      )
    )
      fail("finite paired differences are required");
    const fromStations = first.days.weekday.metrics.stations,
      toStations = next.days.weekday.metrics.stations;
    if (
      fromStations === toStations ||
      (revenue.every((value) => value === 0) &&
        monthlyWalk.every((value) => value === 0) &&
        selectedWalk.every((value) => value === 0))
    )
      continue;
    const revenueSummary = aggregate(revenue),
      contributionSummary = aggregate(contribution);
    const walkSummary = aggregate(monthlyWalk),
      selectedWalkSummary = aggregate(selectedWalk);
    const addedStationHoursPerMonth = stationHours(next) - stationHours(first);
    const addedStaffHoursPerMonth =
      next.monthly.costs.staffHours - first.monthly.costs.staffHours;
    if (
      [
        revenueSummary,
        contributionSummary,
        walkSummary,
        selectedWalkSummary,
      ].some(
        (summary) =>
          !summary ||
          [summary.mean, summary.low, summary.median, summary.high].some(
            (value) => !finite(value),
          ),
      ) ||
      !finite(addedStationHoursPerMonth) ||
      !finite(addedStaffHoursPerMonth)
    )
      fail("finite summaries and resource changes are required");
    variants.push({
      id: candidate.id,
      kind: "station-experiment",
      siteId: first.selected.siteId,
      dayType: first.settings.dayType,
      label: "Modeled additional monthly revenue",
      caption: "Modeled, not a forecast",
      change: {
        scope: "whole-operating-day",
        fromPlannedStations: first.settings.plannedStations,
        toPlannedStations: next.settings.plannedStations,
        fromEffectiveStations: fromStations,
        toEffectiveStations: toStations,
        fromStaffHeadcount: first.settings.staffHeadcount,
        toStaffHeadcount: next.settings.staffHeadcount,
        hours: structuredClone(first.config.hours),
      },
      monthlyRevenueChangeUsd: revenueSummary,
      monthlyContributionChangeUsd: contributionSummary,
      monthlyWalkAwayChange: walkSummary,
      selectedDayWalkAwayChange: selectedWalkSummary,
      addedStationHoursPerMonth,
      addedStaffHoursPerMonth,
      source: {
        mode: "aggregate",
        seedCount: seeds.length,
        seeds: [...seeds],
        outputKind: "simulation",
      },
      origins: [...new Set(input.origins)],
      limitations: [...STATION_EXPERIMENT_LIMITATIONS],
    });
  }
  return variants;
}

/** User-approved objective among positive-revenue, added-effective-station variants. */
export function selectStationExperiment(
  variants: readonly StationExperimentCallout[],
): StationExperimentCallout | null {
  const valid = variants.map((value) =>
    StationExperimentCalloutSchema.parse(value),
  );
  return (
    valid
      .filter(
        (v) =>
          v.monthlyRevenueChangeUsd.mean > 0 &&
          v.change.toEffectiveStations > v.change.fromEffectiveStations,
      )
      .sort(
        (a, b) =>
          b.monthlyRevenueChangeUsd.mean - a.monthlyRevenueChangeUsd.mean ||
          a.addedStationHoursPerMonth - b.addedStationHoursPerMonth ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0] ?? null
  );
}

export const STATION_EXPERIMENT_LIMITATIONS = [
  "Whole-operating-day station counts; no hourly staffing schedule is modeled",
  "Station-hours are a capacity proxy, not labor hours, staffing requirements or equipment dollars",
  "The engine does not bind station capacity to staff headcount; actual helper staff-hours are reported separately",
  "Additional revenue includes all extra completed services, including customers otherwise unfinished at closing; it is not attributed exclusively to walk-away recovery",
  "Walk-away changes count balked plus reneged customers only, excluding unfinished customers at closing",
  "Empirical p5–p95 paired-seed outcomes are simulations, not a forecast or a confidence interval for realized sales",
  "Selection compares only tested variants by mean added revenue, then station-hours; station purchase costs are unknown",
] as const;
