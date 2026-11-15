import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
} from "@/lib/demand/fixtures";
import {
  EvaluationRequestSchema,
  type EvaluationRequest,
} from "@/lib/contracts/evaluation";
import type { CopilotContext } from "@/lib/contracts/copilot-runtime";
import type { Scenario } from "@/lib/contracts/scenario";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";
import {
  evaluateSites,
  evaluateSitesResumable,
} from "@/lib/evaluation/evaluate";
import {
  buildStoredComparison,
  createMemoryComparisonStore,
} from "@/lib/evaluation/store";
import { deriveScenario } from "@/lib/scenario/model";
import { createScenarioPreparer } from "@/lib/scenario/prepare";
import type { ScenarioRepository } from "@/lib/scenario/repository";
import { createScenarioRunner } from "@/lib/scenario/run";
import { createMemoryScenarioExecutionStore } from "@/lib/scenario/run-store-memory";
import { createScenarioService } from "@/lib/scenario/service";
import { createCopilotTools } from "../copilot-registry";
import type { CopilotStoredComparison } from "../copilot-read-tools";

export const EVAL_PROJECT = "eval-project";
export const EVAL_SITE_C = "site-c";

/** Two Houston coffee sites, 7:00-18:00, two stations, two staff, Huff demand. */
export function evalRequest(): EvaluationRequest {
  const config = {
    hours: {
      weekday: { openMin: 420, closeMin: 1080 },
      weekend: { openMin: 420, closeMin: 1080 },
    },
    stations: { planned: 2, usableSf: 1800, sfPerStation: 300 },
    prices: { avgTicketUsd: 6.5 },
    staff: { headcount: 2, wageUsdPerHour: 16 },
    costs: { cogsPctOfRevenue: 0.28 },
    lease: {
      sf: 1800,
      askingRentUsdPerSfYear: 30,
      tripleNet: false,
      buildoutUsd: 30000,
      leaseTermMonths: 60,
    },
    calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
  };
  return EvaluationRequestSchema.parse({
    projectId: EVAL_PROJECT,
    profileId: "eval-profile",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    competitors: COMPETITORS,
    demandSource: "huff",
    seeds: 2,
    seedSet: [3, 7],
    sites: [SITE_A, SITE_B].map((storefront) => ({
      siteId: storefront.id,
      storefront,
      config,
    })),
  });
}

/**
 * Offline copilot workspace: the real scenario service, mutation/read/run tools,
 * preparer and scenario runner over in-memory stores. Nothing calls a provider.
 */
export async function createEvalWorkspace(
  options: { budgetUnits?: number } = {},
) {
  const request = evalRequest();
  const rows = new Map<string, Scenario>();
  const repository = {
    async insert(s: Scenario) {
      rows.set(s.id, s);
      return s;
    },
    async get(projectId: string, id: string) {
      const row = rows.get(id);
      return row?.projectId === projectId ? row : null;
    },
    async list(projectId: string) {
      return [...rows.values()].filter((s) => s.projectId === projectId);
    },
    async appendVersion(projectId, parentId, changes, meta) {
      const parent = await this.get(projectId, parentId);
      if (!parent) throw new Error("missing parent");
      return this.insert(deriveScenario(parent, changes, meta));
    },
  } satisfies Pick<
    ScenarioRepository,
    "insert" | "get" | "list" | "appendVersion"
  >;
  let next = 0;
  const service = createScenarioService({
    repository,
    newId: () => `scenario-${++next}`,
    now: () => new Date("2026-11-14T17:00:00.000Z"),
  });
  const prepare = createScenarioPreparer({
    loadProfile: async () => ({
      ...syntheticHoustonFixture.profile,
      projectId: EVAL_PROJECT,
      id: "eval-profile",
      version: 1,
    }),
    loadLayout: async () => null,
    assemble: async () => ({
      request: structuredClone(request),
      findings: [],
      assumptions: {} as AssemblyMetadata["assumptions"],
    }),
  });
  let evaluations = 0;
  let executionId = 0;
  const comparisonStore = createMemoryComparisonStore({ [EVAL_PROJECT]: 1 });
  const runner = createScenarioRunner({
    scenarios: repository,
    executions: createMemoryScenarioExecutionStore(),
    comparisons: comparisonStore,
    prepare,
    newId: () => `execution-${++executionId}`,
    now: () => new Date("2026-11-14T17:00:00.000Z"),
    ...(options.budgetUnits === undefined
      ? {}
      : { budgetUnits: options.budgetUnits }),
    evaluate: async (...args) => {
      evaluations++;
      return evaluateSitesResumable(...args);
    },
  });

  const base = await service.create(EVAL_PROJECT, {
    siteIds: [SITE_A.id, SITE_B.id],
    profileVersion: 1,
    label: "Baseline",
    author: "founder",
    // Two seeds keep every eval run small (2 seeds x 2 sites x 2 days = 8 units).
    overrides: {
      seedSet: {
        value: [3, 7],
        unit: "seeds",
        origin: "default",
        evidenceIds: ["eval:fixture"],
      },
    },
  });
  // The baseline's saved comparison, as if the founder had already run it.
  const prepared = await prepare(base, "huff");
  const baseComparison: CopilotStoredComparison = buildStoredComparison(
    `c-${base.id}`,
    prepared.request,
    evaluateSites(prepared.request),
  );
  baseComparison.evaluation.assembly = {
    scenario: prepared.scenario,
    findings: [],
    assumptions: prepared.assumptions,
  };
  const comparisons = new Map([[base.id, baseComparison]]);
  const weekdayRunId =
    baseComparison.evaluation.result.sites[0].representative.weekday.runId;

  const tools = createCopilotTools({
    mutations: {
      scenarios: service,
      stationCapacity: async (_projectId, scenario) =>
        scenario.siteIds.map((siteId) => ({
          siteId,
          maxStations: 6,
          layoutId: null,
          evidenceIds: [`listing:${siteId}:usableSf`],
        })),
      validateCandidates: async (_projectId, siteIds) => {
        const known = siteIds.filter((id) => id === EVAL_SITE_C);
        return {
          candidateIds: known.length ? known : ["unknown"],
          evidenceIds: ["inventory:eval"],
        };
      },
      priceAcceptance: async (_projectId, _scenario, change) =>
        change.kind === "price_tier"
          ? { status: "tier_requires_run", comparisonId: null, siteIds: [] }
          : { status: "unavailable", comparisonId: null, siteIds: [] },
    },
    reads: {
      scenarios: service,
      comparisonForScenario: async (_projectId, scenarioId) =>
        comparisons.get(scenarioId) ?? null,
      runForId: async (_projectId, runId) => {
        for (const comparison of comparisons.values()) {
          const run = comparison.runs.find((r) => r.id === runId);
          if (run) return { comparison, run };
        }
        return null;
      },
    },
    runs: { scenarios: service, runner },
  });

  const context: CopilotContext = {
    projectId: EVAL_PROJECT,
    profileId: "eval-profile",
    profileVersion: 1,
    scenarioId: base.id,
    siteId: SITE_A.id,
    runId: weekdayRunId,
    day: "weekday",
    page: `/projects/${EVAL_PROJECT}/workspace`,
    view: "comparison",
    revision: 1,
  };
  return {
    base,
    service,
    tools,
    runner,
    context,
    weekdayRunId,
    comparisons,
    comparisonStore,
    evaluations: () => evaluations,
    scenarios: () => [...rows.values()],
  };
}
export type EvalWorkspace = Awaited<ReturnType<typeof createEvalWorkspace>>;
