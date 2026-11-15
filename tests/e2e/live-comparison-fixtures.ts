import type { Page } from "@playwright/test";
import {
  EvaluationRequestSchema,
  type SensitivityAssumption,
  type SensitivityResult,
} from "../../lib/contracts/evaluation";
import { evaluateSites } from "../../lib/evaluation/evaluate";
import { buildStoredComparison } from "../../lib/evaluation/store";
import { FIXTURE_PERSONA_SET, makeStore } from "../../lib/demand/fixtures";
import { completeIntake, liveSearch } from "./live-site-fixtures";

// Pure invented observations and seeded simulations. No database or model calls.
export const liveComparisonId = "comparison-synthetic-57";
export const liveCandidateIds = ["201:301", "202:302"] as const;
export const liveComparisonSearch = structuredClone(liveSearch);
const second = structuredClone(liveComparisonSearch.candidates[0]);
second.candidate.id = liveCandidateIds[1];
second.candidate.address = "202 Invented St";
second.candidate.name = "Synthetic second café";
second.propertyId = "102";
second.listingId = "202";
liveComparisonSearch.candidates.push(second);
liveComparisonSearch.totalMatched = 2;

const hours = { openMin: 420, closeMin: 1140 };
function comparisonRequest(siteIds: readonly string[]) {
  return EvaluationRequestSchema.parse({
    projectId: "houston-coffee",
    profileId: "profile-live-57",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    demandSource: "huff",
    seeds: 3,
    baseSeed: 11,
    sites: siteIds.map((siteId, index) => ({
      siteId,
      storefront: makeStore(siteId, index * 0.3, 0),
      config: {
        hours: { weekday: hours, weekend: hours },
        stations: { planned: 2, usableSf: 1250, sfPerStation: 250 },
        prices: { avgTicketUsd: 6.5 },
        staff: { headcount: 2, wageUsdPerHour: 16 },
        costs: { cogsPctOfRevenue: 0.27 },
        lease: {
          sf: 1250,
          askingRentUsdPerSfYear: 24 + index * 4,
          tripleNet: false,
          buildoutUsd: 24000,
          leaseTermMonths: 36,
        },
        calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
      },
    })),
  });
}
const request = comparisonRequest(liveCandidateIds);
export const liveComparisonRecord = buildStoredComparison(
  liveComparisonId,
  request,
  evaluateSites(request),
);
export const liveComparisonPayload = {
  comparisonId: liveComparisonId,
  outdated: false,
  result: liveComparisonRecord.evaluation.result,
  comparison: liveComparisonRecord.comparison,
  sensitivity: [],
  assembly: {
    findings: [
      {
        code: "DEMOGRAPHICS_DEFAULT",
        message:
          "Demographics partly default: imported coverage is incomplete.",
      },
    ],
    assumptions: {
      "profile.economics.averageTicketUsd": {
        value: 6.5,
        origin: "default" as const,
        evidenceIds: ["hac56-assembly-scenario-v1"],
      },
    },
  },
};

export function liveSensitivityPayload(
  assumption: SensitivityAssumption = "rent",
) {
  const sensitivity: SensitivityResult = {
    assumption,
    unit: assumption === "price" ? "usd" : "multiplier",
    baselineTopSiteId: liveCandidateIds[0],
    topChanges: true,
    points: [
      {
        value: assumption === "price" ? 5 : 0.9,
        topSiteId: liveCandidateIds[0],
        ranking: [...liveCandidateIds],
        meanContributionUsd: {
          [liveCandidateIds[0]]: 2000,
          [liveCandidateIds[1]]: 1800,
        },
      },
      {
        value: assumption === "price" ? 8 : 1.1,
        topSiteId: liveCandidateIds[1],
        ranking: [...liveCandidateIds].reverse(),
        meanContributionUsd: {
          [liveCandidateIds[0]]: 1000,
          [liveCandidateIds[1]]: 1200,
        },
      },
    ],
    breakEven: {
      value: assumption === "price" ? 6.5 : 1,
      fromSiteId: liveCandidateIds[0],
      toSiteId: liveCandidateIds[1],
    },
    conclusion: "The top site changes within the tested range.",
  };
  return {
    comparisonId: liveComparisonId,
    sensitivity,
    comparison: liveComparisonRecord.comparison,
  };
}

export function comparisonForCandidates(ids: readonly string[]) {
  const payload = structuredClone(liveComparisonPayload);
  payload.result.ranking = payload.result.ranking.filter((id) =>
    ids.includes(id),
  );
  payload.result.sites = payload.result.sites
    .filter((site) => ids.includes(site.siteId))
    .map((site, index) => ({
      ...site,
      rank: index + 1,
      tiedWith: site.tiedWith.filter((id) => ids.includes(id)),
    }));
  payload.comparison.results = payload.comparison.results.filter((site) =>
    ids.includes(site.siteId),
  );
  const runs = liveComparisonRecord.runs
    .filter((run) => ids.includes(run.siteId))
    .map((run) => run.id);
  payload.comparison.runIds = runs;
  return payload;
}

export async function mockLiveComparison(
  page: Page,
  options: { outdated?: boolean; jevConfigured?: boolean } = {},
) {
  await completeIntake(page);
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: liveComparisonSearch }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: options.jevConfigured ?? false } }),
  );
  await page.route("**/api/profiles", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        profile: { ...body.profile, id: "profile-live-57", version: 1 },
        persisted: true,
      },
    });
  });
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 201,
      json: comparisonForCandidates(
        route.request().postDataJSON().candidateIds ?? liveCandidateIds,
      ),
    }),
  );
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (route) =>
    route.fulfill({
      json: { ...liveComparisonPayload, outdated: options.outdated ?? false },
    }),
  );
  await page.route("**/api/site-runs/*?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop()!,
    );
    const run = liveComparisonRecord.runs.find((entry) => entry.id === id);
    return route.fulfill(
      run
        ? { json: { run } }
        : { status: 404, json: { code: "RUN_NOT_FOUND" } },
    );
  });
  await page.route(
    `**/api/comparisons/${liveComparisonId}/sensitivity`,
    (route) =>
      route.fulfill({
        json: liveSensitivityPayload(route.request().postDataJSON().assumption),
      }),
  );
}

/**
 * Scene 1: three real (non-synthetic) listings and a seeded comparison over all three, for
 * the guided flow (top 3, compare up to MAX_COMPARE_UNITS). Invented data, no network.
 */
export const threeSiteIds = ["201:301", "202:302", "203:303"] as const;
export const threeSiteSearch = structuredClone(liveComparisonSearch);
{
  const third = structuredClone(threeSiteSearch.candidates[0]);
  third.candidate.id = threeSiteIds[2];
  third.candidate.address = "303 Invented Ave";
  third.candidate.name = "Synthetic third café";
  third.propertyId = "103";
  third.listingId = "203";
  third.candidate.latitude.value = 29.765;
  threeSiteSearch.candidates.push(third);
  threeSiteSearch.totalMatched = 3;
  for (const entry of threeSiteSearch.candidates) entry.candidate.synthetic = false;
}
export const threeSiteComparisonId = "comparison-scene-1";
const threeSiteRecord = buildStoredComparison(
  threeSiteComparisonId,
  comparisonRequest(threeSiteIds),
  evaluateSites(comparisonRequest(threeSiteIds)),
);
export function threeSiteComparison(ids: readonly string[], comparisonId = threeSiteComparisonId) {
  const payload = {
    comparisonId,
    outdated: false,
    result: structuredClone(threeSiteRecord.evaluation.result),
    comparison: { ...structuredClone(threeSiteRecord.comparison), synthetic: false },
    sensitivity: [],
  };
  payload.result.ranking = payload.result.ranking.filter((id) => ids.includes(id));
  payload.result.sites = payload.result.sites
    .filter((site) => ids.includes(site.siteId))
    .map((site, index) => ({
      ...site,
      rank: index + 1,
      tiedWith: site.tiedWith.filter((id) => ids.includes(id)),
    }));
  payload.comparison.results = payload.comparison.results.filter((site) =>
    ids.includes(site.siteId),
  );
  return payload;
}
