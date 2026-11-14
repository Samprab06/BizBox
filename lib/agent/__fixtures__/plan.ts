import { BusinessProfileSchema } from "@/lib/contracts";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import {
  EvaluationRequestSchema,
  type SensitivityResult,
} from "@/lib/contracts/evaluation";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
} from "@/lib/demand/fixtures";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import { buildStoredComparison } from "@/lib/evaluation/store";

/** Shared HAC-24/HAC-26 test fixture: a saved two-site comparison with stable scenarios. */
export function fixture() {
  const profile = BusinessProfileSchema.parse(
    structuredClone(syntheticHoustonFixture.profile),
  );
  profile.id = "profile-v1";
  profile.projectId = "p1";
  for (const budget of [
    profile.economics.monthlyRentCeilingCents,
    profile.economics.startupBudgetCents,
    profile.economics.buildoutBudgetCents,
    profile.economics.monthlyOperatingBudgetCents,
  ])
    budget.value = 100_000_000;
  const hours = { openMin: 360, closeMin: 1080 };
  const request = EvaluationRequestSchema.parse({
    projectId: "p1",
    profileId: profile.id,
    profileVersion: profile.version,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    competitors: COMPETITORS,
    seeds: 2,
    demandSource: "huff",
    sites: [SITE_A, SITE_B].map((storefront, index) => ({
      siteId: storefront.id,
      storefront,
      config: {
        hours: { weekday: hours, weekend: hours },
        stations: {
          planned: 2,
          usableSf: storefront.sizeSqft,
          sfPerStation: 250,
        },
        staff: { headcount: 2, wageUsdPerHour: 16 },
        prices: { avgTicketUsd: 6.5 },
        costs: { cogsPctOfRevenue: 0.28 },
        lease: {
          sf: storefront.sizeSqft,
          askingRentUsdPerSfYear: index ? 22 : 48,
          tripleNet: false,
          buildoutUsd: 30_000,
          leaseTermMonths: 60,
        },
        calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
      },
    })),
  });
  const comparison = buildStoredComparison(
    "comparison-a",
    request,
    evaluateSites(request),
  );
  // Stable saved scenarios isolate rendering from stochastic ranking behavior.
  comparison.evaluation.result.ranking = [SITE_A.id, SITE_B.id];
  comparison.evaluation.result.sites.sort(
    (a, b) =>
      comparison.evaluation.result.ranking.indexOf(a.siteId) -
      comparison.evaluation.result.ranking.indexOf(b.siteId),
  );
  comparison.evaluation.result.sites.forEach((site, index) => {
    site.rank = index + 1;
    site.tiedWith = [];
    site.monthlyContributionUsd = {
      low: index ? 200 : 1000,
      high: index ? 400 : 2000,
      mean: index ? 300 : 1500,
      median: index ? 300 : 1500,
    };
  });
  comparison.evaluation.assembly = {
    assumptions: {
      "profile.averageTicketCents": {
        value: 650,
        origin: "default",
        evidenceIds: ["scenario-ticket"],
      },
      "profile.servers": {
        value: 2,
        origin: "founder",
        evidenceIds: ["founder-capacity"],
      },
      "demographics.children": {
        value: 0.25,
        origin: "default",
        evidenceIds: ["scenario-demographics"],
      },
    },
    findings: [
      {
        code: "DEMOGRAPHIC_DEFAULTS",
        message: "Population demographics are partly default.",
      },
      {
        code: "VEHICLES_NOT_PEOPLE",
        message: "Vehicle counts are not converted to people.",
      },
    ],
  };
  return { projectId: "p1", profile, comparison };
}

export const sweep: SensitivityResult = {
  assumption: "ticket_size",
  unit: "multiplier",
  baselineTopSiteId: SITE_A.id,
  points: [
    {
      value: 0.8,
      topSiteId: SITE_B.id,
      ranking: [SITE_B.id, SITE_A.id],
      meanContributionUsd: {},
    },
    {
      value: 1.2,
      topSiteId: SITE_A.id,
      ranking: [SITE_A.id, SITE_B.id],
      meanContributionUsd: {},
    },
  ],
  topChanges: true,
  breakEven: { value: 1, fromSiteId: SITE_B.id, toSiteId: SITE_A.id },
  conclusion: "The winner changes across the tested bracket.",
};
