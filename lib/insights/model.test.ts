import { describe, expect, it } from "vitest";
import { buildFixtureInsights } from "./fixture";
import { simulateDay } from "@/lib/sim/engine";
import type { ArrivalSchedule, SiteConfigInput } from "@/lib/sim/contracts";
import { aggregateHourly } from "@/lib/sim/hourly";
import { buildInsightsDay, distanceBand, insightsForSite } from "./model";

const config: SiteConfigInput = {
  hours: {
    weekday: { openMin: 480, closeMin: 600 },
    weekend: { openMin: 480, closeMin: 600 },
  },
  stations: { planned: 1, usableSf: 100, sfPerStation: 100 },
  service: { meanServiceMin: 30 },
  prices: { avgTicketUsd: 10 },
  staff: { headcount: 1, wageUsdPerHour: 20 },
  costs: { cogsPctOfRevenue: 0 },
  lease: {
    sf: 100,
    askingRentUsdPerSfYear: 0,
    tripleNet: false,
    buildoutUsd: 0,
    leaseTermMonths: 12,
  },
  calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
};
function run(seed: number, at: number, count = 1) {
  const schedule: ArrivalSchedule = {
    siteId: "s",
    seed,
    dayType: "weekday",
    openMin: 480,
    closeMin: 600,
    demandSource: "huff",
    params: {},
    stayCurves: [{ personaId: "p", points: [{ lineLength: 0, p: 1 }] }],
    customers: Array.from({ length: count }, (_, i) => ({
      id: i === 0 ? "c" : `c${i}`,
      personaId: "p",
      arrivalMin: at,
      stayDraw: 0,
      serviceMin: 0,
    })),
  };
  return simulateDay(schedule, config);
}
const input = () => ({
  runs: [run(1, 480), run(2, 540)],
  personas: [
    { id: "p", kind: "resident" as const, location: { lat: 29, lng: -95 } },
  ],
  siteLocation: { lat: 29, lng: -95 },
  capacityInputs: {
    stations: 1,
    meanServiceMin: 30,
    stationOrigin: null,
    serviceMeanOrigin: "default" as const,
  },
});

describe("insights from all seed days", () => {
  it("copies hourly seed estimates and computes cumulative quantiles before aggregation", () => {
    const data = input();
    const day = buildInsightsDay(data);
    expect(day.seedCount).toBe(2);
    expect(day.hours).toHaveLength(24);
    for (const [hour, row] of aggregateHourly(data.runs).entries())
      expect(day.hours[hour]).toMatchObject(row);
    expect(day.hours[8].revenueUsd).toEqual({ mean: 5, p5: 0, p95: 10 });
    expect(day.hours[9].cumulativeRevenueUsd).toEqual({
      mean: 10,
      p5: 10,
      p95: 10,
    });
    expect(day.hours[8].capacityCustomers).toBe(2);
    expect(day.hours[7].capacityCustomers).toBe(0);
    expect(day.hours[7].p90WaitMin).toEqual({
      mean: null,
      p5: null,
      p95: null,
    });
    expect(day.hours[8].waitObservedSeeds).toBe(1);
  });
  it("keeps missing capacity assumptions unknown and scales partial hours", () => {
    const data = input();
    expect(
      buildInsightsDay({
        ...data,
        capacityInputs: { ...data.capacityInputs, meanServiceMin: null },
      }).hours[8].capacityCustomers,
    ).toBeNull();
    const partial = data.runs.map((r) => ({
      ...r,
      events: [],
      metrics: { ...r.metrics, openMin: 510, closeMin: 570 },
    }));
    const day = buildInsightsDay({ ...data, runs: partial });
    expect(day.hours[8].capacityCustomers).toBe(1);
    expect(day.hours[9].capacityCustomers).toBe(1);
  });
  it("summarizes total walk-away events within each seed before computing the band", () => {
    const base = {
      siteId: "s",
      dayType: "weekday",
      openMin: 480,
      closeMin: 600,
      demandSource: "huff",
      params: {},
    };
    const balk = simulateDay(
      {
        ...base,
        seed: 1,
        stayCurves: [{ personaId: "p", points: [{ lineLength: 0, p: 0 }] }],
        customers: [
          {
            id: "b",
            personaId: "p",
            arrivalMin: 541,
            stayDraw: 0,
            serviceMin: 120,
          },
        ],
      },
      config,
    );
    const renege = simulateDay(
      {
        ...base,
        seed: 2,
        stayCurves: [{ personaId: "p", points: [{ lineLength: 0, p: 1 }] }],
        customers: [
          {
            id: "busy",
            personaId: "p",
            arrivalMin: 480,
            stayDraw: 0,
            serviceMin: 120,
          },
          {
            id: "waiting",
            personaId: "p",
            arrivalMin: 481,
            stayDraw: 0,
            serviceMin: 120,
          },
        ],
      },
      config,
    );
    const hour = buildInsightsDay({ ...input(), runs: [balk, renege] })
      .hours[9];
    expect(hour.balked).toEqual({ mean: 0.5, p5: 0, p95: 1 });
    expect(hour.reneged).toEqual({ mean: 0.5, p5: 0, p95: 1 });
    expect(hour.walkaways).toEqual({ mean: 1, p5: 1, p95: 1 });
  });
  it("counts actual modeled arrivals rather than persona weights and preserves unknown identities", () => {
    const day = buildInsightsDay(input());
    expect(day.mix.kindCounts.resident).toEqual({ mean: 1, p5: 1, p95: 1 });
    expect(day.mix.kindCounts.passby.mean).toBe(0);
    expect(day.mix.distanceCounts.underHalf.mean).toBe(1);
    const unknown = buildInsightsDay({ ...input(), personas: [] });
    expect(unknown.mix.unknownKind.mean).toBe(1);
    expect(unknown.mix.distanceCounts.unknown.mean).toBe(1);
  });
  it.each([
    [0, "underHalf"],
    [0.4999, "underHalf"],
    [0.5, "halfToOne"],
    [1, "oneToThree"],
    [3, "oneToThree"],
    [3.01, "overThree"],
    [null, "unknown"],
  ] as const)("assigns %s miles to %s", (miles, wanted) =>
    expect(distanceBand(miles)).toBe(wanted),
  );
  it("includes resident, worker and pass-by modeled arrivals in the mix", () => {
    const personas = (["resident", "worker", "passby"] as const).map(
      (kind) => ({ id: kind, kind, location: { lat: 29, lng: -95 } }),
    );
    const day = simulateDay(
      {
        siteId: "s",
        seed: 1,
        dayType: "weekday",
        openMin: 480,
        closeMin: 600,
        demandSource: "huff",
        params: {},
        stayCurves: personas.map((p) => ({
          personaId: p.id,
          points: [{ lineLength: 0, p: 1 }],
        })),
        customers: personas.map((p, i) => ({
          id: `c${i}`,
          personaId: p.id,
          arrivalMin: 480 + i,
          stayDraw: 0,
          serviceMin: 0,
        })),
      },
      config,
    );
    const result = buildInsightsDay({ ...input(), runs: [day], personas });
    expect(result.mix.kindCounts).toEqual({
      resident: { mean: 1, p5: 1, p95: 1 },
      worker: { mean: 1, p5: 1, p95: 1 },
      passby: { mean: 1, p5: 1, p95: 1 },
    });
    expect(result.mix.distanceCounts.underHalf.mean).toBe(3);
  });
  it("does not manufacture trip origins from modeled persona locations", () => {
    expect(buildInsightsDay(input()).servedOriginMap.status).toBe(
      "unavailable",
    );
    expect(insightsForSite({})).toMatchObject({ status: "unavailable" });
  });
  it("aggregates explicitly supplied served origins with zero samples for absent seed cells", () => {
    const day = buildInsightsDay({
      ...input(),
      origins: {
        basis: "authored_synthetic_origins",
        sourceLabel: "Authored fixture points",
        frame: { center: { lat: 29, lng: -95 }, cellSideMeters: 250 },
        bySeed: [
          { seed: 1, customers: { c: { lat: 29, lng: -95 } } },
          { seed: 2, customers: {} },
        ],
      },
    });
    expect(day.servedOriginMap).toMatchObject({
      status: "available",
      cells: [{ served: { mean: 0.5, p5: 0, p95: 1 } }],
      unmappedServed: { mean: 0.5, p5: 0, p95: 1 },
    });
  });
  it("treats inherited record keys as missing origins", () => {
    const odd = run(1, 480);
    odd.events = odd.events.map((event) => ({
      ...event,
      customerId: "toString",
    }));
    const day = buildInsightsDay({
      ...input(),
      runs: [odd],
      origins: {
        basis: "authored_synthetic_origins",
        sourceLabel: "Authored test",
        frame: { center: { lat: 29, lng: -95 }, cellSideMeters: 250 },
        bySeed: [{ seed: 1, customers: {} }],
      },
    });
    expect(day.servedOriginMap).toMatchObject({
      status: "available",
      cells: [],
      unmappedServed: { mean: 1, p5: 1, p95: 1 },
    });
  });
  it("makes an over-detailed origin grid unavailable rather than truncating served counts", () => {
    const day = buildInsightsDay({
      ...input(),
      runs: [run(1, 480, 300)],
      origins: {
        basis: "authored_synthetic_origins",
        sourceLabel: "Authored local test points",
        frame: { center: { lat: 29, lng: -95 }, cellSideMeters: 1 },
        bySeed: [
          {
            seed: 1,
            customers: Object.fromEntries(
              Array.from({ length: 300 }, (_, i) => [
                i === 0 ? "c" : `c${i}`,
                { lat: 29, lng: -95 + i * 0.001 },
              ]),
            ),
          },
        ],
      },
    });
    expect(day.servedOriginMap).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("256"),
    });
  });
  it("rejects duplicate seeds and mixed day/site input instead of inventing a distribution", () => {
    expect(() =>
      buildInsightsDay({ ...input(), runs: [run(1, 480), run(1, 540)] }),
    ).toThrow();
    expect(() => buildInsightsDay({ ...input(), runs: [] })).toThrow();
    expect(() =>
      buildInsightsDay({
        ...input(),
        runs: [run(1, 480), { ...run(2, 540), siteId: "other" }],
      }),
    ).toThrow();
  });
  it("rejects stored seed counts that claim more observed wait seeds than exist", () => {
    const fixture = buildFixtureInsights({ seeds: 1 });
    fixture.days.weekday.hours[8].waitObservedSeeds = 2;
    expect(insightsForSite({ insights: fixture }).status).toBe("unavailable");
  });
  it("builds repeatable fixture aggregates and explicitly authored origin cells", () => {
    const a = buildFixtureInsights({ siteId: "fixture", seeds: 3 });
    expect(a).toEqual(buildFixtureInsights({ siteId: "fixture", seeds: 3 }));
    expect(a).toMatchObject({
      synthetic: true,
      seedCount: 3,
      version: "hac94-v1",
    });
    expect(a.days.weekday.servedOriginMap.status).toBe("available");
    expect(insightsForSite({ insights: a })).toEqual({
      status: "available",
      data: a,
    });
    expect(insightsForSite({ siteId: "different", insights: a }).status).toBe(
      "unavailable",
    );
  });
});
