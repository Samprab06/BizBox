import { describe, expect, it } from "vitest";
import { huffInput, jevInput } from "@/lib/demand/fixtures";
import { buildArrivalSchedule } from "@/lib/demand/model";
import { SiteConfigSchema } from "./contracts";
import { simulateDay } from "./engine";
import { computeMonthlyEconomics } from "./economics";
import {
  experimentSettings,
  runExperiment,
  experimentDelta,
} from "./experiment";

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
const demand = huffInput();
const input = { config, demand, seed: 45, dayType: "weekday" as const };

describe("experiment previews", () => {
  it("unchanged settings reproduce direct demand, engine and economics calculations", () => {
    const settings = experimentSettings(input);
    const actual = runExperiment(input, settings);
    const direct = Object.fromEntries(
      (["weekday", "weekend"] as const).map((dayType) => {
        const schedule = buildArrivalSchedule(
          { ...demand, serviceMeanMin: { value: 5, origin: "default" } },
          { seed: 45, dayType, ...config.hours[dayType] },
        );
        return [dayType, simulateDay(schedule, config)];
      }),
    );
    expect(actual.days.weekday).toEqual(direct.weekday);
    expect(actual.days.weekend).toEqual(direct.weekend);
    expect(actual.monthly).toEqual(
      computeMonthlyEconomics(config, {
        weekday: direct.weekday.metrics,
        weekend: direct.weekend.metrics,
      }),
    );
    expect(runExperiment(input, settings)).toEqual(actual);
  });

  it("more stations use the same arrivals and reduce fixture p90 wait", () => {
    const base = runExperiment(input, experimentSettings(input));
    const alternative = runExperiment(input, {
      ...experimentSettings(input),
      plannedStations: 2,
    });
    expect(alternative.schedules.weekday.customers).toEqual(
      base.schedules.weekday.customers,
    );
    expect(alternative.days.weekday.metrics.p90WaitMin!).toBeLessThanOrEqual(
      base.days.weekday.metrics.p90WaitMin!,
    );
    const delta = experimentDelta(base, alternative);
    expect(delta.monthlyContributionUsd).toBe(
      alternative.monthly.contributionUsd - base.monthly.contributionUsd,
    );
    expect(delta.served).toBe(
      alternative.selected.metrics.served - base.selected.metrics.served,
    );
    expect(delta.walkAways).toBe(
      alternative.selected.metrics.abandoned - base.selected.metrics.abandoned,
    );
  });

  it("uses new seed, hours and demand multiplier in generation without mutating inputs", () => {
    const before = JSON.stringify(input);
    const settings = experimentSettings(input);
    const base = runExperiment(input, settings);
    const alternative = runExperiment(input, {
      ...settings,
      seed: 46,
      demandMultiplier: 1.2,
      hours: { ...settings.hours, weekday: { openMin: 480, closeMin: 600 } },
    });
    expect(alternative.schedules.weekday.customers).not.toEqual(
      base.schedules.weekday.customers,
    );
    expect(
      alternative.schedules.weekday.customers.every(
        (c) => c.arrivalMin >= 480 && c.arrivalMin < 600,
      ),
    ).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects invalid settings instead of silently resetting levers", () => {
    const settings = experimentSettings(input);
    expect(() =>
      runExperiment(input, { ...settings, demandMultiplier: NaN }),
    ).toThrow();
    expect(() =>
      runExperiment(input, { ...settings, plannedStations: 0 }),
    ).toThrow();
    expect(() =>
      runExperiment(input, {
        ...settings,
        hours: { ...settings.hours, weekday: { openMin: 600, closeMin: 480 } },
      }),
    ).toThrow();
  });

  it("uses cached Jev price acceptance when changing ticket price without mutating its panel", () => {
    const pricedInput = {
      ...input,
      demand: jevInput(),
      config: { ...config, prices: { avgTicketUsd: 4 } },
    };
    const before = JSON.stringify(pricedInput);
    const settings = experimentSettings(pricedInput);
    const base = runExperiment(pricedInput, settings);
    const alternative = runExperiment(pricedInput, {
      ...settings,
      averageTicketUsd: 6,
    });
    const totalRate = (result: typeof base) =>
      Object.entries(result.schedules.weekday.params)
        .filter(([key]) => key.startsWith("rate.h"))
        .reduce((sum, [, v]) => sum + v.value, 0);
    // Every recorded persona accepts $4 with p=.9 and $6 with p=.6.
    expect(totalRate(alternative) / totalRate(base)).toBeCloseTo(2 / 3, 10);
    expect(JSON.stringify(pricedInput)).toBe(before);
  });

  it("keeps absent waits unknown and rejects a weekday/weekend delta", () => {
    const base = runExperiment(input, experimentSettings(input));
    const empty = {
      ...base,
      selected: {
        ...base.selected,
        metrics: { ...base.selected.metrics, p90WaitMin: null },
      },
      peakHourP90WaitMin: null,
    };
    expect(experimentDelta(empty, base).p90WaitMin).toBeNull();
    expect(experimentDelta(empty, base).peakHourP90WaitMin).toBeNull();
    expect(() =>
      experimentDelta(base, {
        ...base,
        settings: { ...base.settings, dayType: "weekend" },
      }),
    ).toThrow(RangeError);
  });
});
