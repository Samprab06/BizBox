import {
  SiteInsightsSchema,
  type SiteInsights,
} from "@/lib/contracts/insights";
import type { Origin } from "@/lib/demand/contracts";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import { simulateDay } from "@/lib/sim/engine";
import { buildFixtureSchedule } from "@/lib/sim/fixtures/arrival-schedule";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createRng } from "@/lib/sim/random";
import { buildInsightsDay } from "./model";

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
