import { describe, expect, it } from "vitest";
import type {
  ArrivalSchedule,
  Customer,
  DayResult,
  SiteConfigInput,
} from "./contracts";
import { simulateDay } from "./engine";
import { aggregateHourly, hourlySeries, peakHours } from "./hourly";
import { createRng } from "./random";

function run(
  customers: Customer[],
  openMin = 510,
  closeMin = 630,
  stations = 1,
): DayResult {
  const schedule: ArrivalSchedule = {
    siteId: "hourly-site",
    seed: 1,
    dayType: "weekday",
    openMin,
    closeMin,
    demandSource: "huff",
    customers,
    params: {},
    stayCurves: [
      { personaId: "join", points: [{ lineLength: 0, p: 1 }] },
      { personaId: "leave", points: [{ lineLength: 0, p: 0 }] },
    ],
  };
  const config: SiteConfigInput = {
    hours: { weekday: { openMin, closeMin }, weekend: { openMin, closeMin } },
    stations: { planned: stations, usableSf: 1000, sfPerStation: 100 },
    service: { meanServiceMin: 10 },
    prices: { avgTicketUsd: 7.25 },
    staff: { headcount: 1, wageUsdPerHour: 20 },
    costs: { cogsPctOfRevenue: 0.3 },
    lease: {
      sf: 1000,
      askingRentUsdPerSfYear: 20,
      tripleNet: false,
      buildoutUsd: 0,
      leaseTermMonths: 12,
    },
    calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
  };
  return simulateDay(schedule, config);
}

const customer = (
  id: string,
  arrivalMin: number,
  serviceMin: number,
  personaId = "join",
): Customer => ({ id, arrivalMin, serviceMin, personaId, stayDraw: 0.5 });

describe("hourlySeries", () => {
  it("splits queue and busy intervals, and separates completion counts from start-hour waits", () => {
    const result = run([
      customer("a", 530, 15),
      customer("b", 535, 30),
      customer("c", 536, 5, "leave"),
      customer("d", 560, 50),
      customer("e", 561, 1),
      customer("f", 625, 10),
      customer("g", 626, 10),
      customer("outside", 630, 1),
    ]);
    const series = hourlySeries(result.events, result.metrics);
    expect(series).toHaveLength(24);
    expect(series[7]).toMatchObject({
      hour: 7,
      closed: true,
      openMinutes: 0,
      meanQueueLength: 0,
      meanWaitMin: null,
    });
    expect(series[8]).toMatchObject({
      hour: 8,
      openMinutes: 30,
      closed: false,
      arrivals: 3,
      joined: 2,
      served: 0,
      balked: 1,
      reneged: 0,
      meanWaitMin: 0,
      p90WaitMin: 0,
      maxQueueLength: 1,
      revenueUsd: 0,
    });
    expect(series[8].meanQueueLength).toBeCloseTo(5 / 30, 12);
    expect(series[8].stationUtilization).toBeCloseTo(10 / 30, 12);
    expect(series[9]).toMatchObject({
      arrivals: 2,
      joined: 2,
      served: 2,
      reneged: 1,
      meanWaitMin: 12.5,
      p90WaitMin: 15,
      maxQueueLength: 2,
      revenueUsd: 14.5,
      stationUtilization: 1,
    });
    // b queues 540-545, d queues 560-575, e queues 561-581 and reneges.
    expect(series[9].meanQueueLength).toBeCloseTo(40 / 60, 12);
    expect(series[10]).toMatchObject({
      served: 1,
      reneged: 0,
      meanWaitMin: null,
      maxQueueLength: 1,
      revenueUsd: 7.25,
    });
    expect(series[10].meanQueueLength).toBeCloseTo(4 / 30, 12);
    expect(series[10].stationUtilization).toBeCloseTo(30 / 30, 12);
  });

  it("includes closing-boundary completions and abandonments in the last open bucket", () => {
    const result = run(
      [customer("a", 510, 30), customer("b", 520, 10)],
      510,
      540,
    );
    const series = hourlySeries(result.events, result.metrics);
    expect(series[8]).toMatchObject({
      served: 1,
      reneged: 0,
      meanWaitMin: 0,
      revenueUsd: 7.25,
      stationUtilization: 1,
    });
    expect(series[9]).toMatchObject({ closed: true, served: 0, revenueUsd: 0 });
    expect(result.metrics.inServiceAtClose).toBe(1);
    // b starts at close after a completes, so its 20 minute wait is not a served wait.
    const reneging = run(
      [customer("a", 510, 31), customer("b", 520, 10)],
      510,
      540,
    );
    expect(hourlySeries(reneging.events, reneging.metrics)[8].reneged).toBe(1);
  });

  it("handles midnight closure, zero-duration service and simultaneous queue changes", () => {
    const result = run(
      [customer("a", 1380, 60), customer("b", 1430, 0), customer("c", 1430, 0)],
      1380,
      1440,
      2,
    );
    const series = hourlySeries(result.events, result.metrics);
    expect(series[23]).toMatchObject({
      arrivals: 3,
      joined: 3,
      served: 3,
      maxQueueLength: 0,
      meanQueueLength: 0,
      revenueUsd: 21.75,
    });
    expect(series[23].stationUtilization).toBe(0.5);
  });

  it("keeps empty open hours distinct from closed hours", () => {
    const result = run([]);
    const series = hourlySeries(result.events, result.metrics);
    expect(series[9]).toMatchObject({
      closed: false,
      openMinutes: 60,
      arrivals: 0,
      meanWaitMin: null,
      p90WaitMin: null,
      stationUtilization: 0,
      meanQueueLength: 0,
    });
    expect(series[11].closed).toBe(true);
  });

  it("puts hour-boundary starts in the new hour and counts ties after completion before abandonment", () => {
    const result = run(
      [customer("a", 520, 20), customer("b", 520, 10)],
      510,
      570,
    );
    const series = hourlySeries(result.events, result.metrics);
    expect(series[8]).toMatchObject({
      served: 0,
      meanWaitMin: 0,
      p90WaitMin: 0,
      reneged: 0,
      maxQueueLength: 1,
    });
    expect(series[9]).toMatchObject({
      served: 2,
      meanWaitMin: 20,
      p90WaitMin: 20,
      reneged: 0,
      maxQueueLength: 0,
    });
    expect(series[8].meanQueueLength).toBeCloseTo(20 / 30, 12);
    expect(series[9].meanQueueLength).toBe(0);
    expect(series[9].stationUtilization).toBeCloseTo(10 / 30, 12);
  });

  it("handles a full local day and rejects metadata unsupported by the engine", () => {
    const result = run([customer("a", 0, 1440)], 0, 1440);
    const series = hourlySeries(result.events, result.metrics);
    expect(
      series.every(
        (hour) =>
          !hour.closed &&
          hour.openMinutes === 60 &&
          hour.stationUtilization === 1,
      ),
    ).toBe(true);
    expect(series[0].meanWaitMin).toBe(0);
    expect(series[23].served).toBe(1);
    expect(() =>
      hourlySeries([], { ...result.metrics, openMin: 1380, closeMin: 60 }),
    ).toThrow(RangeError);
    expect(() => hourlySeries([], { ...result.metrics, stations: 0 })).toThrow(
      RangeError,
    );
  });

  it.each([1, 2, 4])(
    "reconciles multiple seeded engine runs with %i stations",
    (stations) => {
      for (const seed of [1, 42, 12345]) {
        const rng = createRng(seed);
        const customers = Array.from({ length: 700 }, (_, i) => ({
          ...customer(
            `c${i}`,
            450 + rng.next() * 870,
            rng.lognormal(9, 0.5),
            i % 6 === 0 ? "leave" : "join",
          ),
          stayDraw: rng.next(),
        }));
        const result = run(customers, 495, 1275, stations);
        const before = JSON.stringify(result);
        const series = hourlySeries(result.events, result.metrics);
        for (const field of [
          "arrivals",
          "joined",
          "served",
          "balked",
          "reneged",
          "revenueUsd",
        ] as const) {
          expect(series.reduce((sum, hour) => sum + hour[field], 0)).toBe(
            result.metrics[field],
          );
        }
        const busy = series.reduce(
          (sum, hour) => sum + hour.stationUtilization * hour.openMinutes,
          0,
        );
        expect(
          Math.abs(busy / 780 - result.metrics.stationUtilization),
        ).toBeLessThan(1e-9);
        expect(series).toEqual(hourlySeries(result.events, result.metrics));
        expect(JSON.stringify(result)).toBe(before);
        expect(
          series.every(
            (hour) =>
              hour.stationUtilization >= 0 &&
              hour.stationUtilization <= 1 + 1e-12,
          ),
        ).toBe(true);
      }
    },
  );
});

describe("aggregateHourly", () => {
  it("reports per-field means and nearest-rank seed quantiles, omitting null waits", () => {
    const runs = [
      run([]),
      run([customer("a", 510, 1)]),
      run([customer("a", 510, 1), customer("b", 510, 1)]),
    ];
    const aggregate = aggregateHourly(runs);
    expect(aggregate).toHaveLength(24);
    expect(aggregate[8]).toMatchObject({
      hour: 8,
      closed: false,
      openMinutes: 30,
      arrivals: { mean: 1, p5: 0, p95: 2 },
      served: { mean: 1, p5: 0, p95: 2 },
      joined: { mean: 1, p5: 0, p95: 2 },
      balked: { mean: 0, p5: 0, p95: 0 },
      reneged: { mean: 0, p5: 0, p95: 0 },
      meanWaitMin: { mean: 0.25, p5: 0, p95: 0.5 },
      p90WaitMin: { mean: 0.5, p5: 0, p95: 1 },
      revenueUsd: { mean: 7.25, p5: 0, p95: 14.5 },
    });
    expect(aggregate[8].meanQueueLength.mean).toBeCloseTo(1 / 90, 12);
    expect(aggregate[8].meanQueueLength.p95).toBeCloseTo(1 / 30, 12);
    expect(aggregate[8].maxQueueLength).toEqual({ mean: 1 / 3, p5: 0, p95: 1 });
    expect(aggregate[8].stationUtilization.mean).toBeCloseTo(1 / 30, 12);
    expect(aggregate[8].stationUtilization.p95).toBeCloseTo(2 / 30, 12);
    expect(aggregate[9].meanWaitMin).toEqual({
      mean: null,
      p5: null,
      p95: null,
    });
    expect(aggregate[7]).toMatchObject({
      closed: true,
      arrivals: { mean: 0, p5: 0, p95: 0 },
    });
    expect(aggregateHourly(runs)).toEqual(aggregate);
  });

  it("uses nearest rank across enough seeds to distinguish tail quantiles from extrema", () => {
    const runs = Array.from({ length: 40 }, (_, n) =>
      run(Array.from({ length: n }, (_, i) => customer(`c${i}`, 510, 0))),
    );
    expect(aggregateHourly(runs)[8].arrivals).toEqual({
      mean: 19.5,
      p5: 1,
      p95: 37,
    });
  });

  it("returns no estimates for no seeds, and rejects incompatible opening hours", () => {
    expect(aggregateHourly([])).toEqual([]);
    expect(() => aggregateHourly([run([]), run([], 480, 630)])).toThrow(
      RangeError,
    );
  });
});

describe("peakHours", () => {
  it("ranks open hours independently, breaks ties by hour and omits unknown waits", () => {
    const result = run([
      customer("a", 510, 10),
      customer("b", 510, 10),
      customer("c", 570, 10),
      customer("d", 570, 10),
    ]);
    const series = hourlySeries(result.events, result.metrics);
    const peaks = peakHours(series, 3);
    expect(peaks.arrivals.map((hour) => hour.hour)).toEqual([8, 9, 10]);
    expect(peaks.p90WaitMin.map((hour) => hour.hour)).toEqual([8, 9]);
    expect(peakHours(series, 0)).toEqual({ arrivals: [], p90WaitMin: [] });
    expect(
      peakHours(hourlySeries(run([]).events, run([]).metrics), 100).arrivals,
    ).toHaveLength(3);
    expect(() => peakHours(series, -1)).toThrow(RangeError);
    expect(() => peakHours(series, 1.5)).toThrow(RangeError);
  });
});
