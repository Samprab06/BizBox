import {
  EVALUATION_MODEL_VERSION,
  EvaluationRequestSchema,
  type EvaluationRequest,
} from "@/lib/contracts/evaluation";
import {
  StationObservationsSchema,
  StationExperimentResultSchema,
  type StationObservations,
  type StationExperimentResult,
} from "@/lib/contracts/station-experiment";
import { OriginSchema, type Origin, type DayType } from "@/lib/sim/contracts";
import {
  applyConfigOverrides,
  seedList,
  resolveDemandSource,
  summarize,
} from "@/lib/evaluation/evaluate";
import type { StoredComparison } from "@/lib/evaluation/store";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import { resolveStationCount } from "@/lib/sim/engine";
import {
  selectStationExperiment,
  STATION_EXPERIMENT_LIMITATIONS,
  type StationExperimentCallout,
} from "./station-experiment";

const days = ["weekday", "weekend"] as const;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const invalid = () => {
  throw new RangeError("Stored station observations are incompatible");
};
function signature(request: EvaluationRequest, siteId: string) {
  const {
    sites,
    seeds: _seeds,
    seedSet: _seedSet,
    baseSeed: _baseSeed,
    ...rest
  } = request;
  void _seeds;
  void _seedSet;
  void _baseSeed;
  return {
    ...rest,
    seeds: [...seedList(request)].sort((a, b) => a - b),
    sites: sites
      .map((site) => {
        if (site.siteId !== siteId) return site;
        const { config } = site;
        const { planned: _planned, ...stations } = config.stations;
        const { headcount: _headcount, ...staff } = config.staff;
        void _planned;
        void _headcount;
        return { ...site, config: { ...config, stations, staff } };
      })
      .sort((a, b) => a.siteId.localeCompare(b.siteId)),
  };
}
function checked(record: StoredComparison, siteId: string) {
  const request = EvaluationRequestSchema.parse(record.evaluation.request);
  const result = record.evaluation.result;
  const site = request.sites.find((s) => s.siteId === siteId);
  const output = result.sites.filter((s) => s.siteId === siteId);
  if (
    !site ||
    output.length !== 1 ||
    result.projectId !== request.projectId ||
    result.profileId !== request.profileId ||
    result.profileVersion !== request.profileVersion ||
    result.modelVersion !== EVALUATION_MODEL_VERSION ||
    result.demandSource !== resolveDemandSource(request).source ||
    !same(result.seeds, seedList(request)) ||
    record.comparison.projectId !== request.projectId ||
    record.comparison.profileId !== request.profileId ||
    record.comparison.synthetic !== request.synthetic ||
    record.comparison.id !== record.id
  )
    invalid();
  if (!output[0].stationObservations) return null;
  const observations = StationObservationsSchema.parse(
    output[0].stationObservations,
  );
  const config = applyConfigOverrides(site!.config, request.overrides);
  const seeds = [...seedList(request)].sort((a, b) => a - b);
  if (
    observations.siteId !== siteId ||
    !same(observations.config, config) ||
    !same(
      [...observations.points.map((p) => p.seed)].sort((a, b) => a - b),
      seeds,
    ) ||
    !same(observations.settings, {
      averageTicketUsd: config.prices.avgTicketUsd,
      plannedStations: config.stations.planned,
      staffHeadcount: config.staff.headcount,
      hours: config.hours,
      demandMultiplier: 1,
    })
  )
    invalid();
  for (const p of observations.points) {
    for (const day of days) {
      const m = p.days[day];
      if (
        m.openMin !== config.hours[day].openMin ||
        m.closeMin !== config.hours[day].closeMin ||
        m.stations !== resolveStationCount(config) ||
        m.abandoned !== m.balked + m.reneged ||
        (m.revenueUsd !== m.served * config.prices.avgTicketUsd &&
          Math.abs(m.revenueUsd - m.served * config.prices.avgTicketUsd) >
            1e-7 * Math.max(1, m.revenueUsd))
      )
        invalid();
    }
    const monthly = computeMonthlyEconomics(config, p.days);
    if (
      !same(p.monthly, {
        revenueUsd: monthly.revenueUsd,
        contributionUsd: monthly.contributionUsd,
        staffHours: monthly.costs.staffHours,
      })
    )
      invalid();
  }
  const pointIndex = new Map(observations.points.map((p) => [p.seed, p]));
  const points = seedList(request).map((seed) => pointIndex.get(seed)!);
  if (
    !same(
      output[0].monthlyRevenueUsd,
      summarize(points.map((p) => p.monthly.revenueUsd)),
    ) ||
    !same(
      output[0].monthlyContributionAfterBuildoutUsd,
      summarize(points.map((p) => p.monthly.contributionUsd)),
    )
  )
    invalid();
  return {
    request,
    observations,
    seeds,
    source: result.demandSource,
    layout: record.evaluation.assembly?.scenario?.layout ?? null,
    layoutId: record.evaluation.assembly?.scenario?.layoutId ?? null,
  };
}
const calendar = (o: StationObservations, day: DayType) =>
  day === "weekday"
    ? o.config.calendar.weekdayDaysPerMonth
    : o.config.calendar.weekendDaysPerMonth;
function stationHours(o: StationObservations) {
  return days.reduce(
    (sum, day) =>
      sum +
      ((resolveStationCount(o.config) *
        (o.config.hours[day].closeMin - o.config.hours[day].openMin)) /
        60) *
        calendar(o, day),
    0,
  );
}
/** Only call after validating complete stored request equality; points alone cannot establish paired workloads. */
function summarizePair(
  id: string,
  b: StationObservations,
  a: StationObservations,
  seeds: number[],
  dayType: DayType,
  origins: readonly Origin[],
): StationExperimentCallout | null {
  const fromStations = resolveStationCount(b.config),
    toStations = resolveStationCount(a.config);
  const index = new Map(a.points.map((p) => [p.seed, p]));
  const base = new Map(b.points.map((p) => [p.seed, p]));
  const pairs = seeds.map(
    (seed) => [base.get(seed)!, index.get(seed)!] as const,
  );
  const revenue = pairs.map(
    ([x, y]) => y.monthly.revenueUsd - x.monthly.revenueUsd,
  );
  const contribution = pairs.map(
    ([x, y]) => y.monthly.contributionUsd - x.monthly.contributionUsd,
  );
  const monthlyWalk = (
    o: StationObservations,
    p: StationObservations["points"][number],
  ) =>
    days.reduce(
      (sum, day) =>
        sum + (p.days[day].balked + p.days[day].reneged) * calendar(o, day),
      0,
    );
  const walk = pairs.map(([x, y]) => monthlyWalk(a, y) - monthlyWalk(b, x));
  const selectedWalk = pairs.map(
    ([x, y]) => y.days[dayType].abandoned - x.days[dayType].abandoned,
  );
  if (
    fromStations === toStations ||
    (revenue.every((v) => v === 0) &&
      walk.every((v) => v === 0) &&
      selectedWalk.every((v) => v === 0))
  )
    return null;
  return {
    id,
    kind: "station-experiment",
    siteId: b.siteId,
    dayType,
    label: "Modeled additional monthly revenue",
    caption: "Modeled, not a forecast",
    change: {
      scope: "whole-operating-day",
      fromPlannedStations: b.settings.plannedStations,
      toPlannedStations: a.settings.plannedStations,
      fromEffectiveStations: fromStations,
      toEffectiveStations: toStations,
      fromStaffHeadcount: b.settings.staffHeadcount,
      toStaffHeadcount: a.settings.staffHeadcount,
      hours: structuredClone(b.config.hours),
    },
    monthlyRevenueChangeUsd: summarize(revenue),
    monthlyContributionChangeUsd: summarize(contribution),
    monthlyWalkAwayChange: summarize(walk),
    selectedDayWalkAwayChange: summarize(selectedWalk),
    addedStationHoursPerMonth: stationHours(a) - stationHours(b),
    addedStaffHoursPerMonth:
      pairs[0][1].monthly.staffHours - pairs[0][0].monthly.staffHours,
    source: {
      mode: "aggregate",
      seedCount: seeds.length,
      seeds: [...seeds],
      outputKind: "simulation",
    },
    origins: [...new Set(origins)],
    limitations: [...STATION_EXPERIMENT_LIMITATIONS],
  };
}
export function stationExperimentsFromComparisons(input: {
  baseline: StoredComparison;
  alternatives: readonly { id: string; comparison: StoredComparison }[];
  siteId: string;
  dayType: DayType;
  origins: readonly Origin[];
}): StationExperimentResult {
  try {
    if (
      !input.siteId ||
      !["weekday", "weekend"].includes(input.dayType) ||
      !input.origins.length ||
      input.origins.some((o) => !OriginSchema.safeParse(o).success) ||
      !Array.isArray(input.alternatives) ||
      input.alternatives.length > 8 ||
      new Set(input.alternatives.map((a) => a.id)).size !==
        input.alternatives.length ||
      input.alternatives.some((a) => !a.id.trim())
    )
      invalid();
    const b = checked(input.baseline, input.siteId);
    if (!b)
      return {
        status: "unavailable",
        code: "missing_observations",
        reason:
          "Saved comparison has no paired helper observations. An explicit budgeted run is required.",
      };
    if (b.seeds.length < 2)
      return {
        status: "unavailable",
        code: "insufficient_seeds",
        reason: "At least two unique paired seeds are required for a range.",
      };
    const variants: StationExperimentCallout[] = [];
    for (const candidate of input.alternatives) {
      const a = checked(candidate.comparison, input.siteId);
      if (!a)
        return {
          status: "unavailable",
          code: "missing_observations",
          reason: "An alternative has no retained paired helper observations.",
        };
      if (
        !same(
          signature(b.request, input.siteId),
          signature(a.request, input.siteId),
        ) ||
        a.source !== b.source ||
        !same(a.layoutId, b.layoutId) ||
        !same(a.layout, b.layout)
      )
        invalid();
      const variant = summarizePair(
        candidate.id,
        b.observations,
        a.observations,
        b.seeds,
        input.dayType,
        input.origins,
      );
      if (variant) variants.push(variant);
    }
    return StationExperimentResultSchema.parse({
      status: "available",
      variants,
      selected: selectStationExperiment(variants),
      identity: {
        projectId: b.request.projectId,
        siteId: input.siteId,
        profileId: b.request.profileId,
        profileVersion: b.request.profileVersion,
        modelVersion: input.baseline.evaluation.result.modelVersion,
        baselineComparisonId: input.baseline.id,
        alternativeComparisonIds: input.alternatives.map(
          (a) => a.comparison.id,
        ),
        seeds: b.seeds,
        synthetic: b.request.synthetic,
      },
    });
  } catch {
    return {
      status: "unavailable",
      code: "incompatible",
      reason:
        "Saved inputs or helper observations are incompatible. Compare the same project, site, profile, model, layout and paired workload, changing only station and staff counts.",
    };
  }
}
