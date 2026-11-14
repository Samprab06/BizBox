import { expect, it } from "vitest";
import { buildFixtureInsights } from "./fixture";
import { generateCoreCallouts } from "./callouts";

it("copies exact source-hour numbers and uses earliest ties deterministically", () => {
  const day = buildFixtureInsights({ seeds: 2 }).days.weekday;
  for (const row of day.hours) {
    row.arrivals.mean = row.closed ? 0 : 10;
    row.stationUtilization.mean = row.closed ? 0 : 0.2;
  }
  const callouts = generateCoreCallouts(day);
  expect(callouts.map((c) => c.kind)).toEqual(["peak", "quiet"]);
  for (const callout of callouts) {
    const row = day.hours[callout.hours[0]];
    expect(callout.hours).toEqual([7]);
    expect(callout.values).toEqual({
      arrivals: row.arrivals.mean,
      served: row.served.mean,
      balked: row.balked.mean,
      reneged: row.reneged.mean,
      p90WaitMin: row.p90WaitMin.mean,
      utilization: row.stationUtilization.mean,
      revenueUsd: row.revenueUsd.mean,
    });
    expect(callout.source).toEqual({ mode: "aggregate", seedCount: 2 });
    expect(callout.caption).toBe("Modeled, not a forecast");
  }
  expect(generateCoreCallouts(day)).toEqual(callouts);
});
it("does not call a zero-arrival day busy or return closed-hour callouts", () => {
  const day = buildFixtureInsights({ seeds: 1 }).days.weekday;
  day.hours.forEach((row) => (row.arrivals.mean = 0));
  expect(generateCoreCallouts(day).map((c) => c.kind)).toEqual(["quiet"]);
  day.hours.forEach((row) => (row.closed = true));
  expect(generateCoreCallouts(day)).toEqual([]);
});
