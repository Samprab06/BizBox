import { expect, it } from "vitest";
import {
  fixtureInsightsExperimentInput,
  buildFixtureInsights,
} from "./fixture";
import { runScheduledExperiment } from "@/lib/sim/experiment";
import {
  summarizeStationExperiments,
  selectStationExperiment,
} from "./station-experiment";
import { STATION_EXPERIMENT_FIXTURES } from "./station-experiment-fixture";

it.each(["montrose", "heights"])(
  "static recommendation uses the exact chart schedules/config and actual helper: %s",
  (siteId) => {
    const make = (stations: number) =>
      Array.from({ length: 12 }, (_, i) => {
        const { config, settings, schedules } = fixtureInsightsExperimentInput(
          siteId,
          i + 1,
        );
        return runScheduledExperiment(
          config,
          { ...settings, plannedStations: stations, staffHeadcount: stations },
          schedules,
        );
      });
    const baseline = make(2);
    const variants = summarizeStationExperiments({
      baseline,
      alternatives: [3, 4].map((stations) => ({
        id: `stations-${stations}`,
        results: make(stations),
      })),
      origins: ["default"],
    });
    expect(STATION_EXPERIMENT_FIXTURES[siteId].weekday).toEqual(
      selectStationExperiment(variants),
    );
    expect(STATION_EXPERIMENT_FIXTURES[siteId].weekday).not.toBeNull();
    expect(
      STATION_EXPERIMENT_FIXTURES[siteId].weekday?.addedStaffHoursPerMonth,
    ).toBe(448);
    expect(
      STATION_EXPERIMENT_FIXTURES[siteId].weekday?.monthlyContributionChangeUsd
        .mean,
    ).toBeLessThan(0);
    expect(
      STATION_EXPERIMENT_FIXTURES[siteId].weekend?.monthlyRevenueChangeUsd,
    ).toEqual(
      STATION_EXPERIMENT_FIXTURES[siteId].weekday?.monthlyRevenueChangeUsd,
    );
    const chart = buildFixtureInsights({ siteId, seeds: 12 });
    for (const day of ["weekday", "weekend"] as const) {
      const mean =
        baseline.reduce((sum, r) => sum + r.days[day].metrics.revenueUsd, 0) /
        12;
      expect(chart.days[day].hours[23].cumulativeRevenueUsd.mean).toBeCloseTo(
        mean,
        10,
      );
      expect(chart.days[day].capacityInputs.stations).toBe(
        baseline[0].days[day].metrics.stations,
      );
    }
  },
);
it("prepared helper rejects mismatched schedule identity instead of simulating a different workload", () => {
  const i = fixtureInsightsExperimentInput("fixture", 1);
  expect(() =>
    runScheduledExperiment(i.config, { ...i.settings, seed: 2 }, i.schedules),
  ).toThrow(/schedules/);
  expect(() =>
    runScheduledExperiment(i.config, i.settings, {
      ...i.schedules,
      weekend: { ...i.schedules.weekend, siteId: "other" },
    }),
  ).toThrow(/schedules/);
});
