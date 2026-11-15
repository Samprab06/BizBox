import { describe, expect, it, vi } from "vitest";
import { NessieConsultantResultSchema } from "@/lib/contracts/nessie";
import { createNessieConsultantReader } from "@/lib/nessie/consultant";
import { createInvestigationService } from "./jobs";
import { createMemoryInvestigationRepository } from "./jobs-memory";
import { createInvestigationPlanner } from "./investigation-planner";
import { createInvestigationPlanFinalizer } from "./plan-finalizer";
vi.mock("server-only", () => ({}));
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type { BusinessProfile } from "@/lib/contracts";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import {
  InvestigationJobSchema,
  type InvestigationMilestone,
} from "@/lib/contracts/investigations";
import { buildCatchment } from "@/lib/data/catchments";
import { searchSites } from "@/lib/data/sites";
import {
  makeStore,
  makePersona,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import { createMemoryComparisonStore } from "@/lib/evaluation/store";
import { AssemblyError } from "@/lib/evaluation/assemble";
import {
  createInvestigationTools,
  toolArtifactId,
  type InvestigationToolDependencies,
  type InvestigationToolContext,
  type InvestigationToolName,
} from "./tools";

function setup(configured = false) {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  profile.projectId = "project1";
  profile.id = "profile1";
  for (const feature of Object.values(profile.mustHaves)) feature.value = false;
  const profiles = new Map<string, BusinessProfile>([[profile.id, profile]]);
  const store = createMemoryComparisonStore();
  const ids = ["101:1", "102:2"];
  const polled = new Set<string>();
  const deps: InvestigationToolDependencies = {
    jevConfigured: configured,
    comparisons: store,
    loadProfile: vi.fn<InvestigationToolDependencies["loadProfile"]>(
      async (project, id) => {
        const p = profiles.get(id);
        return p && p.projectId === project ? p : null;
      },
    ),
    saveProfile: vi.fn<InvestigationToolDependencies["saveProfile"]>(
      async (project, p, key) => {
        const id = toolArtifactId("profile", key);
        const old = profiles.get(id);
        if (old) return old;
        const saved = {
          ...p,
          projectId: project,
          id,
          version: profiles.size + 1,
        };
        profiles.set(id, saved);
        return saved;
      },
    ),
    search: vi.fn<InvestigationToolDependencies["search"]>(
      async (p, filters) => {
        const source = {
          origin: "costar" as const,
          dataset: "Synthetic test",
          recordId: "1",
          field: "space",
        };
        return searchSites(
          { profile: p, ...filters },
          {
            properties: ids.map((_, i) => ({
              id: `${i}`,
              city: "Houston",
              latitude: 29.76 + i * 0.001,
              longitude: -95.37,
              data: {},
              source,
            })),
            spaces: ids.map((id, i) => ({
              id,
              listingId: `${i}`,
              propertyId: `${i}`,
              active: true,
              retail: true,
              sizeSqFt: 1200,
              data: {
                spaceUse: "Retail",
                position: "Corner",
                askingRentUsdPerSfYearLow: 24,
                askingRentUsdPerSfYearHigh: 24,
                serviceTypeName: "FullService",
              },
              source,
            })),
            tenancies: [],
            synthetic: true,
          },
        );
      },
    ),
    catchment: vi.fn<InvestigationToolDependencies["catchment"]>(
      async (p, siteId) =>
        buildCatchment({
          site: {
            id: siteId,
            propertyId: "1",
            projectId: p.projectId,
            city: "Houston",
            latitude: 29.76,
            longitude: -95.37,
            frontage: [],
            source: {},
          },
          radiusMeters: 1000,
          radiusOrigin: "default",
          category: "coffee",
          retrievedAt: "2026-11-14T00:00:00Z",
          residents: [],
          workers: [],
          coTenants: [],
          venues: [
            {
              id: "v",
              name: "Test coffee",
              category: "coffee",
              latitude: 29.761,
              longitude: -95.37,
              origin: "public",
              source: {},
            },
          ],
        }),
    ),
    assemble: vi.fn<InvestigationToolDependencies["assemble"]>(
      async (p, selected, options) => {
        if (options.mode === "paid") selected.forEach((id) => polled.add(id));
        const personaSet = {
          catchmentId: "catchment1",
          personas: [
            makePersona("persona1", "resident", 0.1, 0.1, { weight: 10 }),
          ],
        };
        const request = EvaluationRequestSchema.parse({
          projectId: p.projectId,
          profileId: p.id,
          profileVersion: p.version,
          synthetic: true,
          city: "houston",
          category: "coffee",
          priceTier: "mid",
          personaSet,
          demandSource: options.mode === "huff" ? "huff" : "jev",
          seeds: 1,
          sites: selected.map((id, index) => ({
            siteId: id,
            storefront: makeStore(id, index * 0.1, 0),
            ...(options.mode !== "huff" && polled.has(id)
              ? {
                  behaviorTable: makeBehaviorTable(id, personaSet.personas),
                  behaviorTableId: `table:${id}`,
                }
              : {}),
            config: {
              hours: {
                weekday: { openMin: 420, closeMin: 1020 },
                weekend: { openMin: 420, closeMin: 1020 },
              },
              stations: { planned: 2, usableSf: 1200, sfPerStation: 100 },
              service: { meanServiceMin: 4 },
              prices: { avgTicketUsd: options.price ?? 6.5 },
              staff: { headcount: 2, wageUsdPerHour: 15 },
              costs: { cogsPctOfRevenue: 0.3 },
              lease: {
                sf: 1200,
                askingRentUsdPerSfYear: 24,
                tripleNet: false,
                buildoutUsd: 10000,
                leaseTermMonths: 60,
              },
              calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
            },
          })),
        });
        return {
          request,
          findings: [
            { code: "DEFAULTS", message: "Demographics partly default." },
          ],
          assumptions: {},
        };
      },
    ),
    comparisonForRun: vi.fn<InvestigationToolDependencies["comparisonForRun"]>(
      async (project, runId) =>
        [...store.records.values()].find(
          (r) =>
            r.evaluation.request.projectId === project &&
            r.runs.some((run) => run.id === runId),
        ) ?? null,
    ),
  };
  const job = InvestigationJobSchema.parse({
    id: "job1",
    projectId: profile.projectId,
    profileId: profile.id,
    question: "Compare test sites",
    status: "running",
    attempt: 1,
    limits: { toolCalls: 25, pollCustomers: 3, evaluateSites: 3 },
    counters: { toolCalls: 0, pollCustomers: 0, evaluateSites: 0 },
    findings: [],
    lastAdvanceAt: null,
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T00:00:00Z",
    reason: null,
    revision: 0,
  });
  const context: InvestigationToolContext = {
    job,
    milestones: [],
    signal: new AbortController().signal,
    idempotencyKey: "step1",
    deadlineAt: 1_000_000,
  };
  const registry = createInvestigationTools(deps);
  async function execute(name: InvestigationToolName, args: unknown) {
    context.idempotencyKey = `step${context.milestones.length}`;
    const result = await registry.execute(name, args, context);
    context.milestones.push({
      investigationId: job.id,
      attempt: job.attempt,
      seq: context.milestones.length,
      tool: name,
      inputHash: "hash",
      summary: {
        input: JSON.parse(JSON.stringify(args)),
        output: result.summary,
        modelFindings: [],
      },
      createdAt: "2026-11-14T00:00:00Z",
    } satisfies InvestigationMilestone);
    return result;
  }
  return { registry, deps, profile, profiles, context, execute, store, ids };
}

describe("investigation tools over existing scoped services", () => {
  it("exposes exactly eight bounded Zod tools and rejects untrusted scope fields", () => {
    const f = setup();
    expect(f.registry.definitions).toHaveLength(8);
    const schema = f.registry.definitions.find(
      (d) => d.name === "poll_customers",
    )!.schema;
    expect(
      schema.safeParse({
        site_ids: Array.from({ length: 9 }, (_, i) => `${i}:1`),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ site_ids: ["101:1"], projectId: "other" }).success,
    ).toBe(false);
  });
  it("searches, reviews, polls, evaluates, diagnoses and tests sensitivity using durable milestone outputs", async () => {
    const f = setup(true);
    await f.execute("search_sites", {});
    for (const id of f.ids) await f.execute("get_catchment", { site_id: id });
    await f.execute("poll_customers", { site_ids: f.ids, price: 7 });
    const evaluated = await f.execute("evaluate_sites", {
      site_ids: f.ids,
      seeds: 1,
    });
    const summary = evaluated.summary as {
      comparisonId: string;
      ranking: string[];
      sites: { runIds: string[] }[];
      demandSource: string;
    };
    expect(summary.ranking).toHaveLength(2);
    expect(summary.demandSource).toBe("jev");
    expect(vi.mocked(f.deps.assemble).mock.calls.map((c) => c[2].mode)).toEqual(
      ["paid", "cache-only"],
    );
    expect(vi.mocked(f.deps.assemble).mock.calls[1]![2].price).toBe(7);
    // HAC-155: the paid poll carries the step deadline into the Jev panel.
    expect(vi.mocked(f.deps.assemble).mock.calls[0]![4]).toEqual({
      deadlineAt: 1_000_000,
      signal: f.context.signal,
    });
    const run = await f.execute("get_site_run", {
      run_id: summary.sites[0]!.runIds[0],
    });
    expect(run.summary).toHaveProperty("hourly");
    expect(JSON.stringify(run.summary)).not.toContain('"events"');
    const sensitivity = await f.execute("run_sensitivity", {
      comparison_id: summary.comparisonId,
      assumption: "rent",
      values: [0.9, 1, 1.1],
      seeds: 1,
    });
    expect(sensitivity.summary).toHaveProperty("topChanges");
    expect(sensitivity.summary).toHaveProperty("breakEven");
    expect(evaluated.findings).toContain("Demographics partly default.");
  });
  it("reconstructs current saved profile from enveloped milestones after creating a fresh registry", async () => {
    const f = setup();
    const result = await f.execute("save_profile", {
      patch: { businessName: "Changed test coffee" },
    });
    const profileId = (result.summary as { profileId: string }).profileId;
    await createInvestigationTools(f.deps).execute(
      "search_sites",
      {},
      f.context,
    );
    expect(vi.mocked(f.deps.search).mock.calls[0]![0].id).toBe(profileId);
    expect(f.profiles.get(profileId)?.synthetic).toBe(true);
  });
  it("reuses an already committed comparison after a lost checkpoint without evaluating or saving twice", async () => {
    const f = setup();
    await f.execute("search_sites", {});
    const save = f.deps.comparisons.save;
    f.deps.comparisons.save = vi.fn(async (record) => {
      await save(record);
      throw new Error("commit succeeded, caller lost response");
    });
    f.context.idempotencyKey = "same-key";
    const first = await f.registry.execute(
      "evaluate_sites",
      { site_ids: f.ids, seeds: 1 },
      f.context,
    );
    const second = await createInvestigationTools(f.deps).execute(
      "evaluate_sites",
      { site_ids: f.ids, seeds: 1 },
      f.context,
    );
    expect(second.summary).toEqual(first.summary);
    expect(f.deps.assemble).toHaveBeenCalledTimes(1);
    expect(f.deps.comparisons.save).toHaveBeenCalledTimes(1);
  });
  it("uses the same deterministic profile identity on a retried unfinished save", async () => {
    const f = setup();
    f.context.idempotencyKey = "profile-save-key";
    const a = await f.registry.execute(
      "save_profile",
      { patch: {} },
      f.context,
    );
    const b = await createInvestigationTools(f.deps).execute(
      "save_profile",
      { patch: {} },
      f.context,
    );
    expect(a.summary).toEqual(b.summary);
    expect(f.profiles.size).toBe(2);
  });
  it("stops with findings when IDs were not shortlisted or catchments were not reviewed", async () => {
    const f = setup();
    expect(
      await f.registry.execute(
        "get_catchment",
        { site_id: "999:1" },
        f.context,
      ),
    ).toMatchObject({
      done: true,
      findings: [expect.stringContaining("current profile")],
    });
    expect(f.deps.catchment).not.toHaveBeenCalled();
    await f.execute("search_sites", {});
    expect(
      await f.registry.execute(
        "poll_customers",
        { site_ids: f.ids },
        f.context,
      ),
    ).toMatchObject({ done: true });
    expect(f.deps.assemble).not.toHaveBeenCalled();
  });
  it("never accesses foreign-project profiles or unowned comparison IDs", async () => {
    const f = setup();
    f.deps.loadProfile = async () => ({ ...f.profile, projectId: "other" });
    expect(
      await f.registry.execute("search_sites", {}, f.context),
    ).toMatchObject({ done: true, summary: { missingProfile: true } });
    expect(f.deps.search).not.toHaveBeenCalled();
    const g = setup();
    expect(
      await g.registry.execute(
        "run_sensitivity",
        { comparison_id: "foreign", assumption: "rent", values: [1] },
        g.context,
      ),
    ).toMatchObject({ done: true });
  });
  it("never pays for an unconfigured panel and reports the Huff path", async () => {
    const f = setup(false);
    await f.execute("search_sites", {});
    for (const id of f.ids) await f.execute("get_catchment", { site_id: id });
    const poll = await f.execute("poll_customers", { site_ids: f.ids });
    expect(poll.findings).toContain(
      "Jev is not configured; evaluation will use the Huff fallback.",
    );
    await f.execute("evaluate_sites", { site_ids: f.ids });
    expect(vi.mocked(f.deps.assemble).mock.calls.map((c) => c[2].mode)).toEqual(
      ["huff", "huff"],
    );
  });
  it("does not start side effects after the step aborts", async () => {
    const f = setup();
    f.context.signal = AbortSignal.abort(new Error("cutoff"));
    await expect(
      f.registry.execute("save_profile", { patch: {} }, f.context),
    ).rejects.toThrow("cutoff");
    expect(f.deps.loadProfile).not.toHaveBeenCalled();
    expect(f.deps.saveProfile).not.toHaveBeenCalled();
  });
  it("finishes with source findings and a question when every candidate has unknown rent", async () => {
    const f = setup();
    await f.execute("search_sites", {});
    f.deps.assemble = vi.fn().mockRejectedValue(
      new AssemblyError("No candidates have enough known inputs to evaluate", [
        {
          code: "SITE_INPUT_UNKNOWN",
          message: "Excluded: unknown rent.",
          siteId: f.ids[0],
        },
      ]),
    );
    const result = await f.execute("evaluate_sites", { site_ids: f.ids });
    expect(result.done).toBe(true);
    expect(result.findings).toContain("Excluded: unknown rent.");
    expect(result.findings?.at(-1)).toContain("What verified rent");
    expect(result.summary).toMatchObject({
      missingInput: true,
      excludedInputs: [{ siteId: f.ids[0], code: "SITE_INPUT_UNKNOWN" }],
    });
    expect(f.store.records.size).toBe(0);
  });
});

describe("scoped Nessie consultant tool", () => {
  function banking(f: ReturnType<typeof setup>) {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      Response.json({
        items:
          new URL(String(url)).pathname === "/accounts"
            ? [
                {
                  id: "acct_demo",
                  nickname: "Shared demo",
                  type: "Checking",
                  balance_cents: 2000000,
                  available_cents: 1900000,
                },
              ]
            : [],
      }),
    );
    f.deps.readNessieCashBuffer = vi.fn(
      createNessieConsultantReader({
        env: { NESSIE_API_KEY: "test" },
        fetcher,
        now: () => new Date("2026-11-14T17:00:00Z"),
      }),
    );
    return fetcher;
  }
  it("accepts paired stored IDs only and never accepts model-supplied financial amounts", () => {
    const f = setup();
    const schema = f.registry.definitions.find(
      (d) => d.name === "read_nessie_cash_buffer",
    )!.schema;
    expect(schema.safeParse({}).success).toBe(true);
    for (const args of [
      { comparison_id: "cmp1" },
      { site_id: "101:1" },
      { available_cents: 10000 },
      { upfront_cost: 0 },
      { monthly_contribution: 100 },
      { account_id: "../bad" },
    ])
      expect(schema.safeParse(args).success).toBe(false);
  });
  it("derives buildout and operating contribution only from this attempt's stored evaluation", async () => {
    const f = setup();
    banking(f);
    await f.execute("search_sites", {});
    const evaluation = await f.execute("evaluate_sites", {
      site_ids: ["101:1"],
      demand_source: "huff",
      seeds: 1,
    });
    const comparisonId = (evaluation.summary as { comparisonId: string })
      .comparisonId;
    const result = await f.execute("read_nessie_cash_buffer", {
      comparison_id: comparisonId,
      site_id: "101:1",
    });
    const evidence = NessieConsultantResultSchema.parse(result.summary);
    const stored = await f.store.load(f.profile.projectId, comparisonId);
    expect(evidence).toMatchObject({
      status: "ready",
      investigationId: f.context.job.id,
      attempt: 1,
      profileId: f.profile.id,
      profileVersion: f.profile.version,
      scenario: {
        comparisonId,
        siteId: "101:1",
        modeledUpfrontBuildoutCents: 1000000,
      },
    });
    expect(evidence.scenario?.monthlyContributionUsd).toEqual(
      expect.objectContaining({
        low: stored!.evaluation.result.sites[0]!.monthlyContributionUsd.low,
        mean: stored!.evaluation.result.sites[0]!.monthlyContributionUsd.mean,
        high: stored!.evaluation.result.sites[0]!.monthlyContributionUsd.high,
      }),
    );
    expect(result.done).not.toBe(true);
    expect(result.findings?.join(" ")).toMatch(/simulated.*not.*forecast/i);
  });
  it("does not access provider data for foreign, stale-attempt, wrong-site or stale-profile comparisons", async () => {
    const f = setup();
    const fetcher = banking(f);
    await f.execute("search_sites", {});
    const e = await f.execute("evaluate_sites", {
      site_ids: ["101:1"],
      demand_source: "huff",
      seeds: 1,
    });
    const comparisonId = (e.summary as { comparisonId: string }).comparisonId;
    for (const args of [
      { comparison_id: "foreign", site_id: "101:1" },
      { comparison_id: comparisonId, site_id: "999:9" },
    ])
      expect(
        NessieConsultantResultSchema.parse(
          (await f.execute("read_nessie_cash_buffer", args)).summary,
        ).status,
      ).toBe("comparison_unavailable");
    f.profile.version++;
    expect(
      NessieConsultantResultSchema.parse(
        (
          await f.execute("read_nessie_cash_buffer", {
            comparison_id: comparisonId,
            site_id: "101:1",
          })
        ).summary,
      ).status,
    ).toBe("comparison_unavailable");
    f.profile.version--;
    f.context.job.attempt++;
    expect(
      NessieConsultantResultSchema.parse(
        (
          await f.execute("read_nessie_cash_buffer", {
            comparison_id: comparisonId,
            site_id: "101:1",
          })
        ).summary,
      ).status,
    ).toBe("comparison_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports optional unavailable banking as typed nonfatal findings", async () => {
    const f = setup();
    const result = await f.execute("read_nessie_cash_buffer", {});
    expect(NessieConsultantResultSchema.parse(result.summary).status).toBe(
      "unconfigured",
    );
    expect(result.done).not.toBe(true);
    expect(result.findings?.join(" ")).toMatch(/cash.*unavailable/i);
  });
});

it("grounds a financial question through actual Nessie transport, durable resume, and final plan findings", async () => {
  const f = setup();
  let time = Date.parse("2026-11-14T17:00:00Z");
  const now = () => new Date(time);
  const transport = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/bills") time += 1000;
    return Response.json({
      items:
        path === "/accounts"
          ? [
              {
                id: "acct_demo",
                nickname: "Shared demo",
                type: "Checking",
                balance_cents: 2000000,
                available_cents: 1900000,
              },
            ]
          : [],
    });
  });
  f.deps.readNessieCashBuffer = createNessieConsultantReader({
    env: { NESSIE_API_KEY: "test" },
    fetcher: transport,
    now,
  });
  const repository = createMemoryInvestigationRepository({ now });
  const service = createInvestigationService(repository, {
    now,
    id: () => "cash-job",
  });
  const job = await service.create({
    projectId: f.profile.projectId,
    profileId: f.profile.id,
    question: "Can this demo cash buffer cover opening the coffee shop?",
  });
  const choose = vi.fn(
    async ({
      nextSeq,
      milestones,
    }: import("./investigation-planner").InvestigationDecisionInput) => {
      const comparison = milestones.find((m) => m.tool === "evaluate_sites");
      const comparisonId = comparison
        ? (comparison.summary as { output: { comparisonId: string } }).output
            .comparisonId
        : undefined;
      const steps = [
        { tool: "search_sites", args: {} },
        {
          tool: "evaluate_sites",
          args: { site_ids: ["101:1"], demand_source: "huff", seeds: 1 },
        },
        {
          tool: "read_nessie_cash_buffer",
          args: { comparison_id: comparisonId, site_id: "101:1" },
        },
        { tool: "finish", args: {} },
      ];
      const step = steps[nextSeq]!;
      return {
        tool: step.tool,
        argsJson: JSON.stringify(step.args),
        findings: [],
        done: step.tool === "finish",
      };
    },
  );
  const planner = () =>
    createInvestigationPlanner({
      tools: f.registry,
      choose,
      now,
      finalizePlan: createInvestigationPlanFinalizer({
        store: f.store,
        profiles: { load: f.deps.loadProfile },
      }),
    });
  const first = await service.advance(job.id, planner(), {
    maxDurationMs: 1000,
  });
  expect(first.status).toBe("queued");
  expect(first.counters).toMatchObject({
    toolCalls: 3,
    evaluateSites: 1,
    pollCustomers: 0,
  });
  const checkpoints = await repository.listMilestones(job.id, 1);
  const cash = checkpoints.find((m) => m.tool === "read_nessie_cash_buffer")!;
  const output = NessieConsultantResultSchema.parse(
    (cash.summary as { output: unknown }).output,
  );
  expect(output).toMatchObject({
    status: "ready",
    investigationId: job.id,
    scenario: { modeledUpfrontBuildoutCents: 1000000, siteId: "101:1" },
  });
  expect(transport).toHaveBeenCalledTimes(3);
  const finished = await service.advance(job.id, planner());
  expect(finished.status).toBe("succeeded");
  expect(finished.counters.toolCalls).toBe(4);
  expect(transport).toHaveBeenCalledTimes(3);
  const final = (await repository.listMilestones(job.id, 1)).at(-1)!;
  const finalOutput = (
    final.summary as { output: { locationPlan: { findings: unknown[] } } }
  ).output;
  expect(JSON.stringify(finalOutput.locationPlan.findings)).toContain(
    "Capital One Nessie simulated cash",
  );
  expect(JSON.stringify(finalOutput.locationPlan.findings)).toContain(
    "not a forecast",
  );
  expect(choose.mock.calls[0]![0].job.question).toContain("cash buffer");
});
