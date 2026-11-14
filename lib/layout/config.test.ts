import { describe, expect, it } from "vitest";
import { applyLayoutToConfig } from "./config";
import { layoutFixture } from "./layout.fixture";
import { LayoutInputError } from "./model";
import type { SiteConfigInput } from "@/lib/sim/contracts";

const config: SiteConfigInput = {
  hours: {
    weekday: { openMin: 480, closeMin: 540 },
    weekend: { openMin: 480, closeMin: 540 },
  },
  stations: { planned: 12, usableSf: 2000, sfPerStation: 120 },
  queueCapacity: 100,
  service: { meanServiceMin: 10 },
  prices: { avgTicketUsd: 10 },
  staff: { headcount: 1, wageUsdPerHour: 20 },
  costs: { cogsPctOfRevenue: 0.3 },
  lease: {
    sf: 2000,
    askingRentUsdPerSfYear: 24,
    tripleNet: false,
    buildoutUsd: 0,
    leaseTermMonths: 12,
  },
  calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
};
describe("selected layout configuration precedence", () => {
  it("applies selected layout station and queue parameters while preserving unrelated configuration", () => {
    const before = JSON.stringify(config);
    const result = applyLayoutToConfig(layoutFixture(), config);
    expect(result.stations).toEqual({
      planned: 1,
      usableSf: 1500,
      sfPerStation: 100,
    });
    expect(result.queueCapacity).toBe(9);
    expect(result).toMatchObject({
      hours: config.hours,
      service: config.service,
      prices: config.prices,
      staff: config.staff,
      costs: config.costs,
      lease: config.lease,
      calendar: config.calendar,
    });
    expect(JSON.stringify(config)).toBe(before);
  });
  it("rejects a conflicting explicit station override with a repairable field error", () => {
    expect(() =>
      applyLayoutToConfig(layoutFixture(), config, {
        plannedStationsOverride: 2,
      }),
    ).toThrow(LayoutInputError);
    try {
      applyLayoutToConfig(layoutFixture(), config, {
        plannedStationsOverride: 2,
      });
    } catch (error) {
      expect((error as LayoutInputError).fieldErrors).toHaveProperty([
        "scenario.overrides.plannedStations",
      ]);
    }
    expect(
      applyLayoutToConfig(layoutFixture(), config, {
        plannedStationsOverride: 1,
      }).stations.planned,
    ).toBe(1);
  });
  it("validates other config fields instead of making an invalid config executable", () => {
    expect(() =>
      applyLayoutToConfig(layoutFixture(), {
        ...config,
        staff: { headcount: -1, wageUsdPerHour: 20 },
      }),
    ).toThrow(LayoutInputError);
  });
});
