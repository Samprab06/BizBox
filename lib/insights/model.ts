import {
  InsightsDaySchema,
  SiteInsightsSchema,
  InsightOriginFrameSchema,
  InsightPointSchema,
  type InsightEstimate,
  type InsightsDay,
  type SiteInsights,
} from "@/lib/contracts/insights";
import type { Origin, Persona } from "@/lib/demand/contracts";
import type { DayResult, SiteConfigInput } from "@/lib/sim/contracts";
import { aggregateHourly, hourlySeries } from "@/lib/sim/hourly";
import { percentile, simulateDay } from "@/lib/sim/engine";
import { buildFixtureSchedule } from "@/lib/sim/fixtures/arrival-schedule";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createRng } from "@/lib/sim/random";

type Location = { lat: number; lng: number };
type CapacityInputs = InsightsDay["capacityInputs"];
export type ExplicitOrigins = {
  basis: "explicit_sampled_origins" | "authored_synthetic_origins";
  sourceLabel: string;
  frame: { center: Location; cellSideMeters: number };
  bySeed: readonly {
    seed: number;
    customers: Readonly<Record<string, Location>>;
  }[];
};
export type InsightsDayInput = {
  runs: readonly DayResult[];
  personas: readonly (Pick<Persona, "id" | "kind"> & {
    location?: Location | null;
  })[];
  siteLocation: Location;
  capacityInputs: CapacityInputs;
  origins?: ExplicitOrigins;
};

/** Equal-weight empirical seed distribution; quantiles are nearest rank, not a confidence interval. */
function estimate(values: readonly number[]): InsightEstimate {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: sorted.reduce((sum, n) => sum + n, 0) / sorted.length,
    p5: percentile(sorted, 0.05)!,
    p95: percentile(sorted, 0.95)!,
  };
}
export function distanceBand(
  miles: number | null,
): keyof InsightsDay["mix"]["distanceCounts"] {
  if (miles === null || !Number.isFinite(miles) || miles < 0) return "unknown";
  return miles < 0.5
    ? "underHalf"
    : miles < 1
      ? "halfToOne"
      : miles <= 3
        ? "oneToThree"
        : "overThree";
}
function milesBetween(
  a: Location | null | undefined,
  b: Location,
): number | null {
  if (
    !a ||
    ![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite) ||
    Math.abs(a.lat) > 90 ||
    Math.abs(b.lat) > 90 ||
    Math.abs(a.lng) > 180 ||
    Math.abs(b.lng) > 180
  )
    return null;
  const rad = Math.PI / 180,
    dLat = (a.lat - b.lat) * rad,
    dLng = (a.lng - b.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return (6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))) / 1609.344;
}

function originSummary(
  runs: readonly DayResult[],
  origins?: ExplicitOrigins,
): InsightsDay["servedOriginMap"] {
  if (!origins)
    return {
      status: "unavailable",
      reason:
        "Sampled customer trip origins were not supplied; modeled persona locations are not trip origins.",
    };
  const frame = InsightOriginFrameSchema.parse(origins.frame),
    center = frame.center,
    side = frame.cellSideMeters;
  if (!origins.sourceLabel.trim())
    throw new RangeError("Explicit origins require a source label");
  const bySeed = new Map(
    origins.bySeed.map((row) => [row.seed, row.customers]),
  );
  if (
    bySeed.size !== origins.bySeed.length ||
    origins.bySeed.some((row) => !runs.some((run) => run.seed === row.seed))
  )
    throw new RangeError("Origin seeds must be unique and belong to the day");
  const scaleX = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const location = (x: number, y: number) =>
    InsightPointSchema.parse({
      lng: center.lng + x / scaleX,
      lat: center.lat + y / 111320,
    });
  const cells = new Map<string, { q: number; r: number; counts: number[] }>();
  const unmapped = runs.map(() => 0);
  for (const [index, run] of runs.entries()) {
    for (const event of run.events) {
      if (event.type !== "completion") continue;
      const positions = bySeed.get(run.seed);
      const point =
        positions && Object.hasOwn(positions, event.customerId)
          ? positions[event.customerId]
          : undefined;
      if (!point) {
        unmapped[index]++;
        continue;
      }
      InsightPointSchema.parse(point);
      const x = (point.lng - center.lng) * scaleX,
        y = (point.lat - center.lat) * 111320;
      const q = ((Math.sqrt(3) / 3) * x - y / 3) / side,
        r = ((2 / 3) * y) / side;
      let rq = Math.round(q),
        rr = Math.round(r);
      const rs = Math.round(-q - r);
      const dq = Math.abs(rq - q),
        dr = Math.abs(rr - r),
        ds = Math.abs(rs + q + r);
      if (dq > dr && dq > ds) rq = -rr - rs;
      else if (dr > ds) rr = -rq - rs;
      const key = `${rq}:${rr}`;
      if (!cells.has(key) && cells.size >= 256)
        return {
          status: "unavailable",
          reason:
            "Explicit origin data exceeds the 256-cell display limit; supply a coarser grid frame.",
        };
      if (!cells.has(key))
        cells.set(key, { q: rq, r: rr, counts: runs.map(() => 0) });
      cells.get(key)!.counts[index]++;
    }
  }
  return {
    status: "available",
    basis: origins.basis,
    sourceLabel: origins.sourceLabel,
    frame,
    cells: [...cells]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, cell]) => {
        const x = side * Math.sqrt(3) * (cell.q + cell.r / 2),
          y = side * 1.5 * cell.r;
        const polygon = Array.from({ length: 6 }, (_, i) => {
          const angle = ((60 * i - 30) * Math.PI) / 180;
          return location(
            x + side * Math.cos(angle),
            y + side * Math.sin(angle),
          );
        });
        return {
          key,
          center: location(x, y),
          polygon: [...polygon, { ...polygon[0] }],
          served: estimate(cell.counts),
        };
      }),
    unmappedServed: estimate(unmapped),
  };
}

/** All inputs are modeled seed days; never derives uncertainty from a representative run. */
export function buildInsightsDay(input: InsightsDayInput): InsightsDay {
  const { runs, capacityInputs } = input;
  const first = runs[0];
  if (
    !first ||
    runs.length > 100 ||
    new Set(runs.map((r) => r.seed)).size !== runs.length ||
    runs.some(
      (r) =>
        r.siteId !== first.siteId ||
        r.metrics.dayType !== first.metrics.dayType ||
        r.metrics.stations !== capacityInputs.stations,
    )
  )
    throw new RangeError(
      "Insights require 1–100 unique seeds for one site/day type and matching stations",
    );
  const aggregate = aggregateHourly(runs);
  const series = runs.map((run) => hourlySeries(run.events, run.metrics));
  const cumulative = series.map((rows) => {
    let sum = 0;
    return rows.map((row) => (sum += row.revenueUsd));
  });
  const personas = new Map(input.personas.map((p) => [p.id, p]));
  if (personas.size !== input.personas.length)
    throw new RangeError("Persona IDs must be unique");
  const samples = runs.map((run) => {
    const kinds = { resident: 0, worker: 0, passby: 0 },
      distances = {
        underHalf: 0,
        halfToOne: 0,
        oneToThree: 0,
        overThree: 0,
        unknown: 0,
      };
    let unknownKind = 0;
    for (const event of run.events) {
      if (event.type !== "arrival") continue;
      const persona = personas.get(event.personaId);
      if (persona) kinds[persona.kind]++;
      else unknownKind++;
      distances[
        distanceBand(milesBetween(persona?.location, input.siteLocation))
      ]++;
    }
    return { kinds, distances, unknownKind };
  });
  return InsightsDaySchema.parse({
    dayType: first.metrics.dayType,
    mode: "aggregate",
    seedCount: runs.length,
    waitBasis: "completed_customers_by_service_start_hour",
    capacityInputs,
    hours: aggregate.map((row, hour) => ({
      ...row,
      walkaways: estimate(
        series.map((seed) => seed[hour].balked + seed[hour].reneged),
      ),
      cumulativeRevenueUsd: estimate(cumulative.map((seed) => seed[hour])),
      waitObservedSeeds: series.filter(
        (seed) => seed[hour].meanWaitMin !== null,
      ).length,
      capacityCustomers: row.closed
        ? 0
        : capacityInputs.meanServiceMin === null
          ? null
          : (capacityInputs.stations * row.openMinutes) /
            capacityInputs.meanServiceMin,
    })),
    mix: {
      basis: "modeled_arrivals",
      distanceBasis: "straight_line_modeled_persona_to_site",
      kindCounts: Object.fromEntries(
        (["resident", "worker", "passby"] as const).map((kind) => [
          kind,
          estimate(samples.map((s) => s.kinds[kind])),
        ]),
      ),
      unknownKind: estimate(samples.map((s) => s.unknownKind)),
      distanceCounts: Object.fromEntries(
        (
          [
            "underHalf",
            "halfToOne",
            "oneToThree",
            "overThree",
            "unknown",
          ] as const
        ).map((band) => [
          band,
          estimate(samples.map((s) => s.distances[band])),
        ]),
      ),
    },
    servedOriginMap: originSummary(runs, input.origins),
  });
}

export function insightsForSite(
  site: { siteId?: string; insights?: SiteInsights } | null | undefined,
):
  | { status: "available"; data: SiteInsights }
  | { status: "unavailable"; reason: string } {
  if (!site?.insights)
    return {
      status: "unavailable",
      reason:
        "This comparison does not retain all-seed hourly insights. Representative replay data cannot supply cross-seed bands.",
    };
  const parsed = SiteInsightsSchema.safeParse(site.insights);
  if (
    parsed.success &&
    site.siteId !== undefined &&
    parsed.data.siteId !== site.siteId
  )
    return {
      status: "unavailable",
      reason: "Stored hourly insights belong to a different site.",
    };
  return parsed.success
    ? { status: "available", data: parsed.data }
    : {
        status: "unavailable",
        reason:
          "Stored hourly insights are invalid or use an unsupported version.",
      };
}

/** Authored fixture: real seeded engine days, with explicitly synthetic map points. */
export function buildFixtureInsights(
  options: { siteId?: string; seeds?: number } = {},
): SiteInsights {
  const seedCount = options.seeds ?? 12,
    siteId = options.siteId ?? "insights-fixture";
  if (!Number.isInteger(seedCount) || seedCount < 1 || seedCount > 100)
    throw new RangeError("Fixture requires 1–100 seeds");
  const siteLocation = { lat: 29.7458, lng: -95.3914 };
  const personas = syntheticHoustonFixture.personaSet.personas.map((p, i) => ({
    id: p.id,
    kind: i % 2 === 0 ? ("worker" as const) : ("resident" as const),
    location: {
      lat: siteLocation.lat + i * 0.003,
      lng: siteLocation.lng + i * 0.003,
    },
  }));
  const capacityInputs = {
    stations: 2,
    meanServiceMin: 4,
    stationOrigin: "default" as Origin,
    serviceMeanOrigin: "default" as Origin,
  };
  const days = {} as SiteInsights["days"];
  for (const dayType of ["weekday", "weekend"] as const) {
    const config: SiteConfigInput = {
      hours: {
        weekday: { openMin: 420, closeMin: 900 },
        weekend: { openMin: 420, closeMin: 900 },
      },
      stations: { planned: 2, usableSf: 1200, sfPerStation: 100 },
      service: { meanServiceMin: 4 },
      prices: { avgTicketUsd: 6.5 },
      staff: { headcount: 2, wageUsdPerHour: 20 },
      costs: { cogsPctOfRevenue: 0.3 },
      lease: {
        sf: 1200,
        askingRentUsdPerSfYear: 24,
        tripleNet: false,
        buildoutUsd: 0,
        leaseTermMonths: 12,
      },
      calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
    };
    const schedules = Array.from({ length: seedCount }, (_, n) =>
      buildFixtureSchedule({ siteId, dayType, seed: n + 1 }),
    );
    const runs = schedules.map((schedule) => simulateDay(schedule, config));
    const bySeed = schedules.map((schedule) => ({
      seed: schedule.seed,
      customers: Object.fromEntries(
        schedule.customers.map((customer) => {
          const rng = createRng(schedule.seed).fork(
            `insights-fixture-origin:${customer.id}`,
          );
          return [
            customer.id,
            {
              lat: siteLocation.lat + (rng.next() - 0.5) * 0.025,
              lng: siteLocation.lng + (rng.next() - 0.5) * 0.025,
            },
          ];
        }),
      ),
    }));
    days[dayType] = buildInsightsDay({
      runs,
      personas,
      siteLocation,
      capacityInputs,
      origins: {
        basis: "authored_synthetic_origins",
        sourceLabel:
          "Authored synthetic customer points; not observed geography",
        frame: { center: siteLocation, cellSideMeters: 250 },
        bySeed,
      },
    });
  }
  return SiteInsightsSchema.parse({
    version: "hac94-v1",
    siteId,
    synthetic: true,
    seedCount,
    days,
  });
}
