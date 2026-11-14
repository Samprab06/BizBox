import { expect, it } from "vitest";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
  SiteEvaluationSchema,
} from "@/lib/contracts/evaluation";
import { FIXTURE_PERSONA_SET, SITE_A } from "@/lib/demand/fixtures";
import { evaluateSites } from "./evaluate";
import { buildStoredComparison } from "./store";

it("persists true all-seed hourly data without changing monthly economics or requiring legacy data", () => {
  const request = EvaluationRequestSchema.parse({
    projectId: "p",
    profileId: "profile",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    demandSource: "huff",
    seedSet: [3, 7],
    sites: [
      {
        siteId: SITE_A.id,
        storefront: SITE_A,
        config: {
          hours: {
            weekday: { openMin: 480, closeMin: 600 },
            weekend: { openMin: 480, closeMin: 600 },
          },
          stations: { planned: 1, usableSf: 100, sfPerStation: 100 },
          prices: { avgTicketUsd: 10 },
          staff: { headcount: 1, wageUsdPerHour: 20 },
          costs: { cogsPctOfRevenue: 0 },
          lease: {
            sf: 100,
            askingRentUsdPerSfYear: 0,
            tripleNet: false,
            buildoutUsd: 0,
            leaseTermMonths: 12,
          },
          calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
        },
      },
    ],
  });
  const run = evaluateSites(request);
  const site = run.result.sites[0];
  expect(site.insights).toBeDefined();
  const insights = site.insights!;
  expect(insights).toMatchObject({
    siteId: SITE_A.id,
    seedCount: 2,
    synthetic: true,
  });
  expect(insights.days.weekday.hours[8].capacityCustomers).toBeNull();
  expect(insights.days.weekday.servedOriginMap.status).toBe("unavailable");
  const expectedMonthly =
    insights.days.weekday.hours[23].cumulativeRevenueUsd.mean * 20 +
    insights.days.weekend.hours[23].cumulativeRevenueUsd.mean * 8;
  expect(site.monthlyRevenueUsd.mean).toBeCloseTo(expectedMonthly, 8);
  const stored = buildStoredComparison("comparison", request, run);
  expect(stored.evaluation.result.sites[0].insights).toEqual(insights);
  const legacy = structuredClone(run.result);
  delete legacy.sites[0].insights;
  expect(EvaluationResultSchema.safeParse(legacy).success).toBe(true);
  expect(
    SiteEvaluationSchema.safeParse({
      ...site,
      insights: { ...insights, siteId: "other" },
    }).success,
  ).toBe(false);
});
