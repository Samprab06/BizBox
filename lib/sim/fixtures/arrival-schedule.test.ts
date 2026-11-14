import { describe, expect, it } from "vitest";
import { TIME_BLOCKS, TIME_BLOCK_HOURS, type TimeBlock } from "@/lib/demand/contracts";
import { simulateDay } from "@/lib/sim/engine";
import {
  FIXTURE_HOURS,
  FIXTURE_SCENARIO_COUNT,
  buildFixtureSchedule,
  categoryTimeBlocks,
  fixtureDailyCustomers,
  fixtureScenarioSeeds,
  peakArrivalHour,
} from "./arrival-schedule";

/** Expected visits per clock hour read from the schedule's own rate params. */
function expectedByHour(params: Record<string, { value: number }>): number[] {
  return Array.from({ length: 24 }, (_, h) => params[`rate.h${String(h).padStart(2, "0")}`]?.value ?? 0);
}

function blockSums(hourly: number[]): Record<TimeBlock, number> {
  const out = {} as Record<TimeBlock, number>;
  for (const b of TIME_BLOCKS) {
    const [h0, h1] = TIME_BLOCK_HOURS[b];
    out[b] = hourly.slice(h0, h1).reduce((s, v) => s + v, 0);
  }
  return out;
}

const BASE = { siteId: "site-synthetic-a", seed: 1, dayType: "weekday" as const };
// Open all day (05:00-21:00) so that every block is fully inside opening hours.
const ALL_DAY = { openMin: 300, closeMin: 1260 };

describe("coffee fixture arrival curve", () => {
  it("peaks between 08:00 and 11:00 in expectation", () => {
    const schedule = buildFixtureSchedule({ ...BASE, ...ALL_DAY });
    const hourly = expectedByHour(schedule.params);
    const peak = hourly.indexOf(Math.max(...hourly));
    expect(peak).toBeGreaterThanOrEqual(8);
    expect(peak).toBeLessThan(11);
  });

  it("peaks between 08:00 and 11:00 in the seeded arrivals of the default opening hours", () => {
    for (const siteIndex of [0, 1]) {
      for (let i = 0; i < FIXTURE_SCENARIO_COUNT; i++) {
        const { weekday } = fixtureScenarioSeeds(i);
        const schedule = buildFixtureSchedule({ ...BASE, siteIndex, seed: weekday });
        const peak = peakArrivalHour(schedule);
        expect(peak).not.toBeNull();
        expect(peak!).toBeGreaterThanOrEqual(8);
        expect(peak!).toBeLessThan(11);
      }
    }
  });

  it("uses the category fixture blocks and hits the target daily customers", () => {
    expect(categoryTimeBlocks("coffee")).toEqual({
      early_morning: 0.1,
      morning: 0.4,
      midday: 0.2,
      afternoon: 0.2,
      evening: 0.1,
    });
    for (const [siteIndex, dayType] of [[0, "weekday"], [1, "weekday"], [0, "weekend"]] as const) {
      const schedule = buildFixtureSchedule({ ...BASE, siteIndex, dayType });
      expect(schedule.params["expected.dailyCustomers"]?.value).toBeCloseTo(
        fixtureDailyCustomers(siteIndex, dayType),
        6,
      );
      expect(schedule.params["arrivals.clippedPersonaHours"]?.value).toBe(0);
      expect(schedule.openMin).toBe(FIXTURE_HOURS.openMin);
      expect(schedule.closeMin).toBe(FIXTURE_HOURS.closeMin);
    }
  });
});

describe("smoothed block totals", () => {
  it("match the unsmoothed totals within 1 expected visit", () => {
    for (const dayType of ["weekday", "weekend"] as const) {
      const opts = { ...BASE, dayType, ...ALL_DAY, dailyCustomers: 200 };
      const smooth = blockSums(expectedByHour(buildFixtureSchedule({ ...opts, smooth: true }).params));
      const flat = blockSums(expectedByHour(buildFixtureSchedule({ ...opts, smooth: false }).params));
      for (const b of TIME_BLOCKS) expect(Math.abs(smooth[b] - flat[b])).toBeLessThan(1);
    }
  });
});

describe("determinism and seeds", () => {
  it("the same seed gives an identical schedule", () => {
    const a = buildFixtureSchedule({ ...BASE, seed: 7 });
    const b = buildFixtureSchedule({ ...BASE, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).toBe(7);
    expect(JSON.stringify(buildFixtureSchedule({ ...BASE, seed: 8 }))).not.toBe(JSON.stringify(a));
  });

  it("keeps the comparison fixture's scenario seeds", () => {
    expect(fixtureScenarioSeeds(0)).toEqual({ weekday: 1, weekend: 25 });
    expect(fixtureScenarioSeeds(23)).toEqual({ weekday: 24, weekend: 48 });
  });

  it("is a valid engine input", () => {
    const schedule = buildFixtureSchedule({ ...BASE });
    const day = simulateDay(schedule, {
      hours: { weekday: FIXTURE_HOURS, weekend: FIXTURE_HOURS },
      stations: { planned: 2, usableSf: 1500, sfPerStation: 250 },
      prices: { avgTicketUsd: 6.5 },
      staff: { headcount: 2, wageUsdPerHour: 16 },
      costs: { cogsPctOfRevenue: 0.27 },
      lease: { sf: 1500, askingRentUsdPerSfYear: 30, tripleNet: false, buildoutUsd: 24000, leaseTermMonths: 36 },
      calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
    });
    expect(day.metrics).toBeDefined();
  });
});
