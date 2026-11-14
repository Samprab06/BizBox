import { syntheticHoustonFixture } from "./houston-coffee";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { ScenarioSchema } from "@/lib/contracts/scenario";
import {
  FIXTURE_PERSONA_SET,
  SITE_A,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import { buildStoredComparison } from "@/lib/evaluation/store";

/** Invented, seeded example artifacts for HAC-83/88 integration. Never a live fallback. */
export function createCopilotExample() {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  profile.projectId = "project-copilot-example";
  Object.values(profile.mustHaves).forEach((flag) => {
    flag.value = false;
  });
  const scenario = ScenarioSchema.parse({
    id: "scenario-copilot-example",
    projectId: profile.projectId,
    parentId: null,
    siteIds: [SITE_A.id],
    profileVersion: profile.version,
    overrides: {},
    layoutId: null,
    label: "Current setup — invented example",
    author: "founder",
    rationale: null,
    createdAt: "2026-11-14T00:00:00Z",
  });
  const request = EvaluationRequestSchema.parse({
    projectId: profile.projectId,
    profileId: profile.id,
    profileVersion: profile.version,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    demandSource: "jev",
    seeds: 1,
    sites: [
      {
        siteId: SITE_A.id,
        storefront: SITE_A,
        behaviorTable: makeBehaviorTable(SITE_A.id),
        behaviorTableId: "invented-cached-panel",
        config: {
          hours: {
            weekday: { openMin: 480, closeMin: 600 },
            weekend: { openMin: 480, closeMin: 600 },
          },
          stations: { planned: 1, usableSf: 100, sfPerStation: 100 },
          prices: { avgTicketUsd: 4 },
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
  const comparison = buildStoredComparison(
    "comparison-copilot-example",
    request,
    evaluateSites(request),
  );
  comparison.evaluation.assembly = {
    scenario: { id: scenario.id, layoutId: null, overrides: {}, layout: null },
    findings: [],
    assumptions: {},
  };
  return { profile, scenario, request, comparison };
}
