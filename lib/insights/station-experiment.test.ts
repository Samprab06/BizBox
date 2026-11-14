import { describe, expect, it, vi } from "vitest";
import { huffInput } from "@/lib/demand/fixtures";
import { SiteConfigSchema } from "@/lib/sim/contracts";
import {
  experimentSettings,
  runExperiment,
  experimentDelta,
  type ExperimentResult,
} from "@/lib/sim/experiment";
import { summarize } from "@/lib/evaluation/evaluate";
import {
  summarizeStationExperiments,
  type StationExperimentInput,
} from "./station-experiment";

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
    tripleNet: true,
    opexUsdPerSfYear: 4,
    buildoutUsd: 9000,
    leaseTermMonths: 36,
  },
  calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
});
const seeds = [11, 22, 33, 44];
function results(plannedStations = 1, staffHeadcount = 1): ExperimentResult[] {
  return seeds.map((seed) => {
    const input = {
      demand: huffInput(),
      config,
      seed,
      dayType: "weekday" as const,
    };
    return runExperiment(input, {
      ...experimentSettings(input),
      plannedStations,
      staffHeadcount,
    });
  });
}
const baseline = results();
const alternative = results(2, 2);
function input(): StationExperimentInput {
  return {
    baseline,
    alternatives: [{ id: "two-stations", results: alternative }],
    origins: ["costar", "default"],
  };
}
// Independent four-observation nearest-rank expectations, not the production aggregator.
function four(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / 4,
    low: sorted[0],
    median: sorted[1],
    high: sorted[3],
  };
}

describe("station experiment completed-result summaries", () => {
  it("matches actual helper revenue/contribution deltas across paired seeds exactly", () => {
    const value = input();
    value.alternatives = [
      { id: "two-stations", results: [...alternative].reverse() },
    ];
    const [callout] = summarizeStationExperiments(value);
    expect(callout).toBeDefined();
    const revenue = seeds.map(
      (_, index) =>
        alternative[index]!.monthly.revenueUsd -
        baseline[index]!.monthly.revenueUsd,
    );
    const contribution = seeds.map(
      (_, index) =>
        experimentDelta(baseline[index]!, alternative[index]!)
          .monthlyContributionUsd,
    );
    expect(callout!.monthlyRevenueChangeUsd).toEqual(four(revenue));
    expect(callout!.monthlyContributionChangeUsd).toEqual(four(contribution));
    expect(callout!.label).toBe("Modeled additional monthly revenue");
    expect(callout!.caption).toBe("Modeled, not a forecast");
    expect(callout!.source).toMatchObject({
      mode: "aggregate",
      seedCount: 4,
      seeds,
    });
    expect(callout!.origins).toEqual(["costar", "default"]);
    expect(callout!.source.outputKind).toBe("simulation");
  });
  it("weights balked plus reneged once per calendar and keeps selected-day delta separate", () => {
    const [callout] = summarizeStationExperiments(input());
    const walkAways = seeds.map((_, index) => {
      const b = baseline[index]!,
        a = alternative[index]!;
      const d = (day: "weekday" | "weekend") =>
        a.days[day].metrics.balked +
        a.days[day].metrics.reneged -
        b.days[day].metrics.balked -
        b.days[day].metrics.reneged;
      return d("weekday") * 22 + d("weekend") * 8;
    });
    expect(callout!.monthlyWalkAwayChange).toEqual(four(walkAways));
    expect(callout!.selectedDayWalkAwayChange).toEqual(
      four(
        seeds.map(
          (_, index) =>
            experimentDelta(baseline[index]!, alternative[index]!).walkAways,
        ),
      ),
    );
  });
  it("reports whole-day station-hours proxy and actual helper staff-hours independently", () => {
    const sameStaff = results(2, 1);
    const [callout] = summarizeStationExperiments({
      ...input(),
      alternatives: [{ id: "same-staff", results: sameStaff }],
    });
    // 13 weekday hours *22 days +11 weekend hours *8 days =374 hours.
    expect(callout!.addedStationHoursPerMonth).toBe(374);
    expect(callout!.addedStaffHoursPerMonth).toBe(0);
    expect(
      summarizeStationExperiments(input())[0]!.addedStaffHoursPerMonth,
    ).toBe(374);
    expect(callout!.change.scope).toBe("whole-operating-day");
    expect(callout!.limitations.join(" ")).toMatch(/not.*labor|not.*staff/i);
    expect(callout!.limitations.join(" ")).toMatch(/closing/);
  });
  it("suppresses identical outcomes, capacity-clamped station changes and staff-cost-only edits", () => {
    expect(
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "same", results: baseline }],
      }),
    ).toEqual([]);
    expect(
      summarizeStationExperiments({
        ...input(),
        baseline: results(4),
        alternatives: [{ id: "clamped", results: results(5) }],
      }),
    ).toEqual([]);
    expect(
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "staff-only", results: results(1, 2) }],
      }),
    ).toEqual([]);
  });
  it("does not fabricate ranges from a representative run or empty seed data", () => {
    expect(
      summarizeStationExperiments({
        ...input(),
        baseline: [],
        alternatives: [],
      }),
    ).toEqual([]);
    expect(
      summarizeStationExperiments({
        ...input(),
        baseline: baseline.slice(0, 1),
        alternatives: [{ id: "one-seed", results: alternative.slice(0, 1) }],
      }),
    ).toEqual([]);
  });
  it("rejects missing/duplicate/unknown seed observations and marginal summaries", () => {
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "missing", results: alternative.slice(1) }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        baseline: [baseline[0]!, baseline[0]!],
      }),
    ).toThrow(RangeError);
    const unknown = structuredClone(alternative);
    Reflect.deleteProperty(unknown[0]!.settings, "seed");
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "unknown", results: unknown }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        baseline: {
          mean: 100,
          low: 50,
          high: 150,
        } as unknown as ExperimentResult[],
      }),
    ).toThrow(RangeError);
  });
  it.each([
    "arrival",
    "customer",
    "service",
    "price",
    "hours",
    "demand",
    "site",
    "day",
  ])("rejects incomparable %s inputs", (change) => {
    const edited = structuredClone(alternative);
    const first = edited[0]!;
    if (change === "arrival")
      first.schedules.weekday.customers[0]!.arrivalMin += 1;
    if (change === "customer")
      first.schedules.weekday.customers[0]!.id += "-other";
    if (change === "service")
      first.schedules.weekday.customers[0]!.serviceMin += 1;
    if (change === "price") first.settings.averageTicketUsd += 1;
    if (change === "hours") first.settings.hours.weekday.openMin += 60;
    if (change === "demand") first.settings.demandMultiplier += 0.5;
    if (change === "site") first.selected.siteId = "another-site";
    if (change === "day") first.settings.dayType = "weekend";
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "changed", results: edited }],
      }),
    ).toThrow(RangeError);
  });
  it("does not compare queue-dependent arrival decisions or service-start timestamps", () => {
    expect(alternative[0]!.days.weekday.events).not.toEqual(
      baseline[0]!.days.weekday.events,
    );
    expect(summarizeStationExperiments(input())).toHaveLength(1);
  });
  it("keeps helper values finite and refuses unknown origins", () => {
    const edited = structuredClone(alternative);
    edited[0]!.monthly.revenueUsd = Infinity;
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        alternatives: [{ id: "bad", results: edited }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeStationExperiments({
        ...input(),
        origins: ["unknown"] as never,
      }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeStationExperiments(input(), {
        summarize: () => ({ mean: Infinity, low: 0, median: 0, high: 0 }),
      }),
    ).toThrow(RangeError);
  });
  it("preserves inputs and exposes variants without choosing a winner", () => {
    const value = {
      ...input(),
      alternatives: [
        ...input().alternatives,
        { id: "three-stations", results: results(3) },
      ],
    };
    const before = JSON.stringify(value);
    const actual = summarizeStationExperiments(value);
    expect(actual.map((variant) => variant.id)).toEqual([
      "two-stations",
      "three-stations",
    ]);
    expect(JSON.stringify(value)).toBe(before);
    expect(actual.every((variant) => !Object.hasOwn(variant, "cheapest"))).toBe(
      true,
    );
  });
  it("uses injectable existing helper/statistics dependencies without running experiments", () => {
    const delta = vi.fn(experimentDelta),
      aggregate = vi.fn(summarize);
    const [actual] = summarizeStationExperiments(input(), {
      delta,
      summarize: aggregate,
    });
    expect(actual!.monthlyContributionChangeUsd).toEqual(
      four(
        seeds.map(
          (_, index) =>
            experimentDelta(baseline[index]!, alternative[index]!)
              .monthlyContributionUsd,
        ),
      ),
    );
    expect(delta).toHaveBeenCalledTimes(4);
    expect(aggregate).toHaveBeenCalled();
  });
});
