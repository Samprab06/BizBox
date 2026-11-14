import { describe, expect, it, vi } from "vitest";
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
  it("exposes exactly seven bounded Zod tools and rejects untrusted scope fields", () => {
    const f = setup();
    expect(f.registry.definitions).toHaveLength(7);
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
    f.deps.assemble = vi
      .fn()
      .mockRejectedValue(
        new AssemblyError(
          "No candidates have enough known inputs to evaluate",
          [
            {
              code: "SITE_INPUT_UNKNOWN",
              message: "Excluded: unknown rent.",
              siteId: f.ids[0],
            },
          ],
        ),
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
