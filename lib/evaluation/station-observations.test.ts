import { expect, it, vi } from "vitest";
import {
  EvaluationRequestSchema,
  SiteEvaluationSchema,
} from "@/lib/contracts/evaluation";
import {
  FIXTURE_PERSONA_SET,
  SITE_A,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import { CATEGORY_DEFAULTS } from "@/lib/demand/defaults";
import { buildArrivalSchedule } from "@/lib/demand/model";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import * as engine from "@/lib/sim/engine";
import * as experiment from "@/lib/sim/experiment";
import {
  applyConfigOverrides,
  evaluateSites,
  repriceBehaviorTable,
  summarize,
} from "./evaluate";

it.each(["huff", "jev"] as const)(
  "retains actual helper points without extra engine days or historical metric/event changes (%s)",
  (source) => {
    const request = EvaluationRequestSchema.parse({
      projectId: "p",
      profileId: "v1",
      profileVersion: 1,
      synthetic: true,
      city: "houston",
      category: "coffee",
      priceTier: "mid",
      personaSet: FIXTURE_PERSONA_SET,
      demandSource: source,
      seedSet: [3, 7, 11],
      overrides: { priceUsd: 7.25, scaleMultiplier: 1.3, rentMultiplier: 0.9 },
      sites: [
        {
          siteId: SITE_A.id,
          storefront: SITE_A,
          behaviorTable: makeBehaviorTable(SITE_A.id),
          config: {
            hours: {
              weekday: { openMin: 480, closeMin: 600 },
              weekend: { openMin: 510, closeMin: 630 },
            },
            stations: { planned: 2, usableSf: 1000, sfPerStation: 250 },
            service: { meanServiceMin: 4 },
            prices: { avgTicketUsd: 6.5 },
            staff: { headcount: 2, wageUsdPerHour: 18 },
            costs: { cogsPctOfRevenue: 0.3 },
            lease: {
              sf: 1000,
              askingRentUsdPerSfYear: 20,
              tripleNet: true,
              opexUsdPerSfYear: 2,
              buildoutUsd: 5000,
              leaseTermMonths: 36,
            },
            calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
          },
        },
      ],
    });
    const site = request.sites[0],
      config = applyConfigOverrides(site.config, request.overrides);
    // Historical pipeline: direct demand generation -> two simulateDay calls -> monthly economics.
    const demand = {
      site: site.storefront,
      personaSet: request.personaSet,
      city: request.city,
      category: request.category,
      priceTier: request.priceTier,
      serviceMeanMin: { value: 4, origin: "default" as const },
      scale: {
        value: CATEGORY_DEFAULTS.coffee.scale.value * 1.3,
        origin: "default" as const,
      },
      demand:
        source === "jev"
          ? {
              source: "jev" as const,
              behavior: repriceBehaviorTable(site.behaviorTable!, 6.5, 7.25),
            }
          : {
              source: "huff" as const,
              huff: { competitors: request.competitors },
            },
    };
    const historical = request.seedSet!.map((seed) => {
      const days = Object.fromEntries(
        (["weekday", "weekend"] as const).map((dayType) => [
          dayType,
          engine.simulateDay(
            buildArrivalSchedule(demand, {
              seed,
              dayType,
              ...config.hours[dayType],
            }),
            config,
          ),
        ]),
      ) as Record<"weekday" | "weekend", ReturnType<typeof engine.simulateDay>>;
      return {
        seed,
        days,
        monthly: computeMonthlyEconomics(config, {
          weekday: days.weekday.metrics,
          weekend: days.weekend.metrics,
        }),
      };
    });
    const helper = vi.spyOn(experiment, "runExperiment"),
      simulation = vi.spyOn(engine, "simulateDay");
    try {
      const run = evaluateSites(request),
        result = run.result.sites[0];
      expect(
        SiteEvaluationSchema.safeParse({
          ...result,
          stationObservations: {
            ...result.stationObservations!,
            siteId: "other",
          },
        }).success,
      ).toBe(false);
      expect(helper).toHaveBeenCalledTimes(3);
      expect(simulation).toHaveBeenCalledTimes(6);
      expect(result.monthlyRevenueUsd).toEqual(
        summarize(historical.map((p) => p.monthly.revenueUsd)),
      );
      expect(result.monthlyContributionUsd).toEqual(
        summarize(historical.map((p) => p.monthly.operatingContributionUsd)),
      );
      expect(result.monthlyContributionAfterBuildoutUsd).toEqual(
        summarize(historical.map((p) => p.monthly.contributionUsd)),
      );
      const median = result.monthlyContributionUsd.median;
      const representative = [...historical].sort(
        (a, b) =>
          Math.abs(a.monthly.operatingContributionUsd - median) -
          Math.abs(b.monthly.operatingContributionUsd - median),
      )[0];
      expect(run.representativeDays[SITE_A.id]).toEqual(representative.days);
      for (const [i, point] of result.stationObservations!.points.entries()) {
        for (const day of ["weekday", "weekend"] as const)
          expect(historical[i].days[day].metrics).toMatchObject(
            point.days[day],
          );
        expect(point.monthly).toEqual({
          revenueUsd: historical[i].monthly.revenueUsd,
          contributionUsd: historical[i].monthly.contributionUsd,
          staffHours: historical[i].monthly.costs.staffHours,
        });
      }
      const legacy = structuredClone(run.result);
      delete legacy.sites[0].stationObservations;
      expect(legacy.sites[0].insights).toBeDefined();
    } finally {
      helper.mockRestore();
      simulation.mockRestore();
    }
  },
);
