import { expect, it } from "vitest";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { huffInput } from "@/lib/demand/fixtures";
import { SiteConfigSchema } from "@/lib/sim/contracts";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import { buildStoredComparison } from "@/lib/evaluation/store";
import { runExperiment, experimentSettings } from "@/lib/sim/experiment";
import {
  summarizeStationExperiments,
  selectStationExperiment,
} from "./station-experiment";
import { stationExperimentsFromComparisons } from "./station-experiment-producer";

const demand = huffInput();
const config = SiteConfigSchema.parse({
  hours: {
    weekday: { openMin: 360, closeMin: 1140 },
    weekend: { openMin: 420, closeMin: 1080 },
  },
  stations: { planned: 1, usableSf: 1200, sfPerStation: 250 },
  service: { meanServiceMin: 5 },
  prices: { avgTicketUsd: 8 },
  staff: { headcount: 1, wageUsdPerHour: 18 },
  costs: { cogsPctOfRevenue: 0.3 },
  lease: {
    sf: 1200,
    askingRentUsdPerSfYear: 30,
    tripleNet: false,
    buildoutUsd: 9000,
    leaseTermMonths: 36,
  },
  calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
});
const seeds = [11, 22, 33, 44];
function request(stations = 1, staff = 1) {
  return EvaluationRequestSchema.parse({
    projectId: "p",
    profileId: "profile",
    profileVersion: 1,
    synthetic: true,
    city: demand.city,
    category: demand.category,
    priceTier: demand.priceTier,
    personaSet: demand.personaSet,
    competitors:
      demand.demand.source === "huff" ? demand.demand.huff.competitors : [],
    demandSource: "huff",
    seedSet: seeds,
    sites: [
      {
        siteId: demand.site.id,
        storefront: demand.site,
        config: {
          ...config,
          stations: { ...config.stations, planned: stations },
          staff: { ...config.staff, headcount: staff },
        },
      },
    ],
  });
}
function stored(stations = 1, staff = 1) {
  const req = request(stations, staff);
  return buildStoredComparison(
    `cmp-${stations}-${staff}`,
    req,
    evaluateSites(req),
  );
}
const baseline = stored(),
  alternative = stored(2, 2);
const input = () => ({
  baseline,
  alternatives: [{ id: "two", comparison: alternative }],
  siteId: demand.site.id,
  dayType: "weekday" as const,
  origins: ["default" as const],
});
function full(
  stations = 1,
  staff = 1,
  dayType: "weekday" | "weekend" = "weekday",
) {
  return seeds.map((seed) => {
    const i = { config, demand, seed, dayType };
    return runExperiment(i, {
      ...experimentSettings(i),
      plannedStations: stations,
      staffHeadcount: staff,
    });
  });
}
it.each(["weekday", "weekend"] as const)(
  "retains compact actual-helper points and exactly matches the full adapter (%s)",
  (dayType) => {
    const artifact = baseline.evaluation.result.sites[0].stationObservations;
    expect(artifact?.points.map((p) => p.seed)).toEqual(seeds);
    expect(JSON.stringify(artifact)).not.toMatch(
      /"(events|customers|schedules)"/,
    );
    const result = stationExperimentsFromComparisons({ ...input(), dayType });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.variants).toEqual(
      summarizeStationExperiments({
        baseline: full(1, 1, dayType),
        alternatives: [{ id: "two", results: full(2, 2, dayType) }],
        origins: ["default"],
      }),
    );
    expect(result.selected).toEqual(result.variants[0]);
  },
);
it("does not synthesize missing legacy observations or accept incompatible saved inputs", () => {
  const legacy = structuredClone(baseline);
  delete legacy.evaluation.result.sites[0].stationObservations;
  expect(
    stationExperimentsFromComparisons({ ...input(), baseline: legacy }),
  ).toMatchObject({ status: "unavailable", code: "missing_observations" });
  for (const change of [
    (c: typeof alternative) => {
      c.evaluation.request.profileVersion++;
    },
    (c: typeof alternative) => {
      c.evaluation.request.sites[0].config.prices.avgTicketUsd++;
    },
    (c: typeof alternative) => {
      c.evaluation.request.personaSet.personas[0].weight++;
    },
    (c: typeof alternative) => {
      Object.assign(c.evaluation.result, { modelVersion: "other" });
    },
    (c: typeof alternative) => {
      c.evaluation.result.sites[0].stationObservations!.points[0].monthly
        .revenueUsd++;
    },
  ]) {
    const changed = structuredClone(alternative);
    change(changed);
    expect(
      stationExperimentsFromComparisons({
        ...input(),
        alternatives: [{ id: "two", comparison: changed }],
      }).status,
    ).toBe("unavailable");
  }
});
it("selects positive added revenue, then fewer station hours and stable ID, retaining negative contribution", () => {
  const result = stationExperimentsFromComparisons(input());
  if (result.status !== "available" || !result.selected)
    throw new Error("Expected variant");
  const a = structuredClone(result.selected);
  a.monthlyRevenueChangeUsd.mean = 100;
  a.monthlyWalkAwayChange.mean = 0; // Closing-time recoveries remain eligible.
  a.monthlyContributionChangeUsd.mean = -100;
  a.addedStationHoursPerMonth = 500;
  a.id = "z";
  const b = structuredClone(a);
  b.id = "b";
  b.addedStationHoursPerMonth = 300;
  const c = structuredClone(b);
  c.id = "a";
  expect(selectStationExperiment([a, b, c])).toEqual(c);
  const higher = structuredClone(a);
  higher.monthlyRevenueChangeUsd.mean = 101;
  expect(selectStationExperiment([c, higher])).toEqual(higher);
  c.monthlyRevenueChangeUsd.mean = 0;
  expect(selectStationExperiment([c])).toBeNull();
  a.change.toEffectiveStations = a.change.fromEffectiveStations;
  expect(selectStationExperiment([a])).toBeNull();
});

it("validates persisted identity, source, paired inputs and compact point integrity", () => {
  const mutations: ((c: typeof alternative) => void)[] = [
    (c) => {
      c.id = "other";
    },
    (c) => {
      c.comparison.projectId = "other";
    },
    (c) => {
      c.evaluation.request.synthetic = false;
    },
    (c) => {
      c.evaluation.request.profileId = "other";
    },
    (c) => {
      c.evaluation.request.sites[0].storefront.location.lat += 0.01;
    },
    (c) => {
      c.evaluation.request.sites[0].config.service.meanServiceMin = 6;
    },
    (c) => {
      c.evaluation.request.sites[0].config.hours.weekday.openMin++;
    },
    (c) => {
      c.evaluation.request.sites[0].config.calendar.weekdayDaysPerMonth++;
    },
    (c) => {
      c.evaluation.request.seedSet = [11, 22];
    },
    (c) => {
      c.evaluation.request.demandSource = "jev";
    },
    (c) => {
      c.evaluation.result.demandSource = "jev";
    },
    (c) => {
      c.evaluation.result.sites[0].monthlyRevenueUsd.mean++;
    },
    (c) => {
      c.evaluation.result.sites[0].stationObservations!.points[0].seed = 22;
    },
    (c) => {
      c.evaluation.result.sites[0].stationObservations!.points[0].days.weekday.stations = 99;
    },
    (c) => {
      c.evaluation.result.sites[0].stationObservations!.points[0].monthly.contributionUsd =
        Infinity;
    },
  ];
  for (const mutate of mutations) {
    const comparison = structuredClone(alternative);
    mutate(comparison);
    expect(
      stationExperimentsFromComparisons({
        ...input(),
        alternatives: [{ id: "two", comparison }],
      }).status,
    ).toBe("unavailable");
  }
  expect(
    stationExperimentsFromComparisons({
      ...input(),
      alternatives: Array.from({ length: 9 }, (_, i) => ({
        id: String(i),
        comparison: alternative,
      })),
    }).status,
  ).toBe("unavailable");
});
it("returns no recommendation for identical, capped and singleton data and never mutates saved records", () => {
  const before = structuredClone(input());
  expect(
    stationExperimentsFromComparisons({
      ...input(),
      alternatives: [{ id: "same", comparison: baseline }],
    }),
  ).toMatchObject({ status: "available", selected: null, variants: [] });
  expect(
    stationExperimentsFromComparisons({
      ...input(),
      baseline: stored(4),
      alternatives: [{ id: "capped", comparison: stored(5) }],
    }),
  ).toMatchObject({ status: "available", selected: null, variants: [] });
  const req = request();
  req.seedSet = [11];
  const single = buildStoredComparison("single", req, evaluateSites(req));
  expect(
    stationExperimentsFromComparisons({ ...input(), baseline: single }),
  ).toMatchObject({ status: "unavailable", code: "insufficient_seeds" });
  stationExperimentsFromComparisons(input());
  expect(input()).toEqual(before);
});

it("retains actual negative helper contribution without excluding additional revenue", () => {
  const result = stationExperimentsFromComparisons({
    ...input(),
    alternatives: [{ id: "expensive-staff", comparison: stored(2, 20) }],
  });
  if (result.status !== "available") throw new Error(result.reason);
  expect(result.selected?.monthlyRevenueChangeUsd.mean).toBeGreaterThan(0);
  expect(result.selected?.monthlyContributionChangeUsd.mean).toBeLessThan(0);
  expect(result.variants).toEqual(
    summarizeStationExperiments({
      baseline: full(),
      alternatives: [{ id: "expensive-staff", results: full(2, 20) }],
      origins: ["default"],
    }),
  );
});
