import { AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { FIXTURE_PERSONA_SET, SITE_A } from "@/lib/demand/fixtures";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { ScenarioSchema, type Scenario } from "@/lib/contracts/scenario";
import {
  CopilotReadResultSchema,
  type CopilotReadResult,
  type CopilotReadToolName,
} from "@/lib/contracts/copilot-read-tools";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import { buildStoredComparison } from "@/lib/evaluation/store";
import {
  createCopilotReadTools,
  type CopilotReadDependencies,
  type ScopedSiteSearchResult,
} from "./copilot-read-tools";

class ScriptedModel extends BaseChatModel {
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "copilot-reads-offline";
  }
  bindTools() {
    return this;
  }
  async _generate() {
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected model call");
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}
function setup(twoSites = false) {
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
  if (twoSites)
    request.sites.push({
      ...structuredClone(request.sites[0]),
      siteId: "site-z",
      storefront: { ...SITE_A, id: "site-z" },
    });
  const makeScenario = (id: string): Scenario =>
    ScenarioSchema.parse({
      id,
      projectId: "p",
      parentId: null,
      siteIds: request.sites.map((s) => s.siteId).sort(),
      profileVersion: 1,
      overrides: {},
      layoutId: null,
      label: id,
      author: "founder",
      rationale: null,
      createdAt: "2026-11-14T00:00:00Z",
    });
  const scenarios = [makeScenario("s1"), makeScenario("s2")];
  const evaluation = evaluateSites(request);
  const comparisons = scenarios.map((s) => {
    const record = buildStoredComparison(
      `c-${s.id}`,
      structuredClone(request),
      structuredClone(evaluation),
    );
    record.evaluation.assembly = {
      scenario: { id: s.id, layoutId: null, overrides: {}, layout: null },
      findings: [],
      assumptions: {},
    };
    return record;
  });
  const candidate = {
    ...syntheticHoustonFixture.candidates[0],
    projectId: "p",
  };
  const amount = {
    value: 100,
    unit: "USD cents",
    origin: "default" as const,
    evidenceIds: ["e"],
  };
  const searchResult: ScopedSiteSearchResult = {
    projectId: "p",
    scenarioId: "s1",
    profileId: "profile",
    profileVersion: 1,
    result: {
      candidates: [
        {
          candidate,
          propertyId: "property",
          listingId: "listing",
          position: null,
          score: 10,
          scoreComponents: {
            rentFit: 10,
            sizeFit: 0,
            position: 0,
            frontage: 0,
            anchorCotenants: 0,
          },
          scoreEvidenceId: "e",
          baseRentCents: amount,
          opexCents: amount,
          totalMonthlyCostCents: amount,
          flags: [],
          evidenceIds: ["e"],
          sources: [],
        },
      ],
      filters: [],
      mostRestrictiveFilter: null,
      emptyReason: null,
      totalMatched: 1,
      evidence: [
        {
          id: "e",
          origin: "default",
          description: "Synthetic scoped fixture",
          sources: [],
          limitations: [],
        },
      ],
      modelVersion: "site-prescore-v1",
    },
  };
  const deps: CopilotReadDependencies = {
    scenarios: {
      get: vi.fn(async (_project, id) => {
        const s = scenarios.find((s) => s.id === id);
        if (!s) throw Object.assign(new Error("secret"), { code: "not_found" });
        return s;
      }),
    },
    search: vi.fn(async () => searchResult),
    comparisonForScenario: vi.fn(
      async (_p, id) =>
        comparisons.find((c) => c.evaluation.assembly!.scenario!.id === id) ??
        null,
    ),
    runForId: vi.fn(async (_p, id) => {
      const comparison = comparisons.find((c) =>
        c.runs.some((r) => r.id === id),
      );
      return comparison
        ? { comparison, run: comparison.runs.find((r) => r.id === id)! }
        : null;
    }),
  };
  const controller = new AbortController();
  const context = {
    projectId: "p",
    evidenceId: "action",
    signal: controller.signal,
  };
  return {
    scenarios,
    comparisons,
    searchResult,
    deps,
    context,
    controller,
    registry: createCopilotReadTools(deps),
  };
}
const cases: {
  name: CopilotReadToolName;
  args: Record<string, unknown>;
  status: CopilotReadResult["status"];
}[] = [
  { name: "find_sites", args: { scenario_id: "s1" }, status: "found" },
  { name: "compare_scenarios", args: { a: "s1", b: "s2" }, status: "compared" },
  { name: "explain_hour", args: {}, status: "explained" },
  { name: "diagnose", args: { scenario_id: "s1" }, status: "diagnosed" },
  {
    name: "focus_view",
    args: { scenario_id: "s1", view: "overview" },
    status: "unsupported",
  },
];
describe("read tools through a compiled offline deepagents graph", () => {
  it.each(cases)(
    "$name returns verified references or explicit unsupported",
    async ({ name, args, status }) => {
      const { registry, context, comparisons } = setup();
      if (name === "explain_hour")
        args = { run_id: comparisons[0].runs[0].id, hour: 8 };
      let output: CopilotReadResult | undefined;
      const agent = createDeepAgent({
        model: new ScriptedModel([
          new AIMessage({
            content: "",
            tool_calls: [{ id: "read", name, args }],
          }),
          new AIMessage("Review the references."),
        ]),
        tools: registry.definitions.map((d) =>
          tool(
            async (input: unknown) => {
              output = await registry.execute(d.name, input, context);
              return JSON.stringify(output);
            },
            { name: d.name, description: d.description, schema: d.schema },
          ),
        ),
        middleware: [
          { name: "FilesystemMiddleware", tools: [] },
          { name: "subAgentMiddleware", tools: [] },
        ],
      });
      await agent.invoke(
        { messages: [{ role: "user", content: "Read this saved scenario." }] },
        { recursionLimit: 10 },
      );
      expect(CopilotReadResultSchema.parse(output).status).toBe(status);
      expect(JSON.stringify(output)).not.toMatch(
        /"(?:events|value|score|mean|low|high)":/,
      );
      if (output?.status === "compared") {
        expect(output.rankingChanged).toBe(false);
        expect(output.references).toContainEqual({
          kind: "comparison_delta",
          comparisonIdA: "c-s1",
          comparisonIdB: "c-s2",
          siteId: SITE_A.id,
          metric: "monthlyContributionUsd",
          statistic: "low",
        });
      }
      if (output?.status === "explained")
        expect(output.warnings).toContain("REPRESENTATIVE_RUN_ONLY");
    },
  );
});

describe("read boundaries", () => {
  it("reports actual ranking changes and explicit unmatched IDs without fabricating deltas", async () => {
    const { registry, comparisons, scenarios, context } = setup(true);
    const c = comparisons[1];
    c.evaluation.result.ranking.reverse();
    for (const site of c.evaluation.result.sites) {
      site.rank = c.evaluation.result.ranking.indexOf(site.siteId) + 1;
      c.comparison.results.find((s) => s.siteId === site.siteId)!.rank =
        site.rank;
    }
    expect(
      await registry.execute(
        "compare_scenarios",
        { a: "s1", b: "s2" },
        context,
      ),
    ).toMatchObject({ status: "compared", rankingChanged: true });
    const renamed = "site-other";
    const previous = c.evaluation.result.sites[0].siteId;
    scenarios[1].siteIds = scenarios[1].siteIds
      .map((s) => (s === previous ? renamed : s))
      .sort();
    const input = c.evaluation.request.sites.find(
      (s) => s.siteId === previous,
    )!;
    input.siteId = renamed;
    input.storefront.id = renamed;
    const site = c.evaluation.result.sites.find((s) => s.siteId === previous)!;
    site.siteId = renamed;
    delete site.insights;
    delete site.stationObservations;
    c.evaluation.result.ranking = c.evaluation.result.ranking.map((s) =>
      s === previous ? renamed : s,
    );
    c.comparison.results.find((s) => s.siteId === previous)!.siteId = renamed;
    for (const run of c.runs) if (run.siteId === previous) run.siteId = renamed;
    const output = await registry.execute(
      "compare_scenarios",
      { a: "s1", b: "s2" },
      context,
    );
    expect(output).toMatchObject({
      status: "compared",
      unmatchedSiteIdsA: [previous],
      unmatchedSiteIdsB: [renamed],
    });
    if (output.status === "compared")
      expect(
        output.references
          .filter((r) => r.kind === "comparison_delta")
          .every((r) => r.siteId !== previous && r.siteId !== renamed),
      ).toBe(true);
  });
  it.each(cases)(
    "$name strictly rejects model-supplied project scope",
    async ({ name, args }) => {
      const { registry, context } = setup();
      expect(
        await registry.execute(name, { ...args, projectId: "other" }, context),
      ).toMatchObject({ status: "rejected", code: "INVALID_INPUT" });
    },
  );
  it("checks context, scenario, search scope and scoped evidence", async () => {
    const { registry, context, searchResult, scenarios } = setup();
    expect(
      await registry.execute(
        "find_sites",
        { scenario_id: "s1" },
        { ...context, scenarioId: "s2" },
      ),
    ).toMatchObject({ code: "STALE_CONTEXT" });
    expect(
      await registry.execute(
        "find_sites",
        { scenario_id: "s1" },
        { ...context, profileVersion: 2 },
      ),
    ).toMatchObject({ code: "STALE_CONTEXT" });
    searchResult.scenarioId = "s2";
    expect(
      await registry.execute("find_sites", { scenario_id: "s1" }, context),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
    searchResult.scenarioId = "s1";
    searchResult.result.candidates[0].evidenceIds = ["not-scoped"];
    expect(
      await registry.execute("find_sites", { scenario_id: "s1" }, context),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
    scenarios[0].projectId = "other";
    expect(
      await registry.execute("find_sites", { scenario_id: "s1" }, context),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
  });
  it("never guesses near coordinates and refuses unavailable read adapters", async () => {
    const { deps, context } = setup();
    const registry = createCopilotReadTools({ scenarios: deps.scenarios });
    expect(
      await registry.execute(
        "find_sites",
        { scenario_id: "s1", preferences: { near: "Princeton" } },
        context,
      ),
    ).toMatchObject({ status: "unsupported", code: "NEAR_SEARCH_UNAVAILABLE" });
    for (const [name, args] of [
      ["find_sites", { scenario_id: "s1" }],
      ["compare_scenarios", { a: "s1", b: "s2" }],
      ["explain_hour", { run_id: "run", hour: 8 }],
    ] as const)
      expect(await registry.execute(name, args, context)).toMatchObject({
        status: "unsupported",
      });
  });
  it("compares inherited overrides structurally despite JSONB key ordering", async () => {
    const { registry, context, scenarios, comparisons } = setup();
    const staff = {
      value: 2,
      unit: "people",
      origin: "founder" as const,
      evidenceIds: ["answer"],
    };
    const price = {
      value: 400,
      unit: "cents",
      origin: "default" as const,
      evidenceIds: ["model"],
    };
    scenarios[0].overrides = {
      staffHeadcount: staff,
      averageTicketCents: price,
    };
    comparisons[0].evaluation.assembly!.scenario!.overrides = {
      averageTicketCents: price,
      staffHeadcount: staff,
    };
    expect(
      await registry.execute(
        "compare_scenarios",
        { a: "s1", b: "s2" },
        context,
      ),
    ).toMatchObject({ status: "compared" });
    comparisons[0].evaluation.assembly!.scenario!.overrides.staffHeadcount = {
      ...staff,
      value: 3,
    };
    expect(
      await registry.execute(
        "compare_scenarios",
        { a: "s1", b: "s2" },
        context,
      ),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
  });
  it.each([
    "project",
    "profile",
    "version",
    "scenario",
    "ranking",
    "membership",
  ])("rejects tampered comparison %s", async (kind) => {
    const { registry, context, comparisons } = setup();
    const c = comparisons[0];
    if (kind === "project") c.comparison.projectId = "other";
    if (kind === "profile") c.evaluation.result.profileId = "other";
    if (kind === "version") c.evaluation.request.profileVersion = 2;
    if (kind === "scenario") c.evaluation.assembly!.scenario!.id = "wrong";
    if (kind === "ranking") c.evaluation.result.ranking = ["wrong"];
    if (kind === "membership") c.runs[0].siteId = "wrong";
    expect(
      await registry.execute(
        "compare_scenarios",
        { a: "s1", b: "s2" },
        context,
      ),
    ).toMatchObject({ status: "rejected" });
  });
  it("uses only saved representative hourly fields, refuses wrong day or absent hours", async () => {
    const { registry, comparisons, context } = setup();
    const c = comparisons[0],
      run = c.runs[0];
    const args = { run_id: run.id, hour: 8 };
    expect(
      await registry.execute(
        "explain_hour",
        { ...args, day: "weekend" },
        context,
      ),
    ).toMatchObject({ code: "INVALID_INPUT" });
    const trace = c.evaluation.result.sites[0].representative.weekday;
    trace.hourly.find((h) => h.hour === 8)!.meanWaitMin = null;
    const result = await registry.execute("explain_hour", args, context);
    expect(result).toMatchObject({
      status: "explained",
      warnings: ["REPRESENTATIVE_RUN_ONLY", "MISSING_HOURLY_WAIT"],
    });
    if (result.status === "explained")
      expect(result.references.some((r) => r.metric === "meanWaitMin")).toBe(
        false,
      );
    trace.hourly = [];
    expect(await registry.execute("explain_hour", args, context)).toMatchObject(
      { status: "unsupported", code: "HOUR_UNAVAILABLE" },
    );
    expect(
      await registry.execute("explain_hour", { ...args, hour: 24 }, context),
    ).toMatchObject({ code: "INVALID_INPUT" });
  });
  it("rejects a substituted run, even if its ID exists in the comparison", async () => {
    const { deps, context, comparisons } = setup();
    const c = comparisons[0];
    deps.runForId = async () => ({
      comparison: c,
      run: { ...c.runs[0], profileId: "other" },
    });
    expect(
      await createCopilotReadTools(deps).execute(
        "explain_hour",
        { run_id: c.runs[0].id, hour: 8 },
        context,
      ),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
  });
  it("delegates hooks only after validation and never forwards adapter prose or metrics", async () => {
    const { deps, context } = setup();
    deps.focusView = vi.fn(async () => ({ actionId: "focus" }));
    const registry = createCopilotReadTools(deps);
    expect(
      await registry.execute(
        "focus_view",
        { scenario_id: "s1", view: "comparison" },
        context,
      ),
    ).toMatchObject({ status: "delegated", actionId: "focus" });
    expect(
      await registry.execute(
        "focus_view",
        { scenario_id: "s1", site_id: "wrong", view: "overview" },
        context,
      ),
    ).toMatchObject({ code: "SCOPE_CONFLICT" });
    expect(deps.focusView).toHaveBeenCalledTimes(1);
    deps.focusView = async () => ({ actionId: "focus", secret: 42 });
    expect(
      await createCopilotReadTools(deps).execute(
        "focus_view",
        { scenario_id: "s1", view: "overview" },
        context,
      ),
    ).toMatchObject({ status: "rejected" });
  });
  it("propagates preflight and in-flight cancellation and sanitizes adapter errors", async () => {
    const { deps, context, controller, registry } = setup();
    deps.search = async () => {
      throw new Error("credential https://secret.internal token");
    };
    const failure = await registry.execute(
      "find_sites",
      { scenario_id: "s1" },
      context,
    );
    expect(failure).toMatchObject({ status: "rejected", code: "UNAVAILABLE" });
    expect(JSON.stringify(failure)).not.toContain("secret");
    deps.search = async () => {
      controller.abort();
      throw new Error("cancelled credential");
    };
    await expect(
      registry.execute("find_sites", { scenario_id: "s1" }, context),
    ).rejects.toThrow();
    await expect(
      registry.execute("diagnose", { scenario_id: "s1" }, context),
    ).rejects.toThrow();
  });
});
