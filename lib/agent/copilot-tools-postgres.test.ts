import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotExample } from "@/fixtures/copilot";
import { createPostgresCopilotTools } from "./copilot-tools-postgres";
import { deriveScenario } from "@/lib/scenario/model";
import type { Scenario } from "@/lib/contracts/scenario";
import { searchSites } from "@/lib/data/sites";
import type { SiteInventory } from "@/lib/contracts/sites";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Scenario>(),
  load: vi.fn(),
  listRuns: vi.fn(),
  assemble: vi.fn(),
  search: vi.fn(),
  profile: vi.fn(),
  inventory: vi.fn(),
  layout: vi.fn(),
  runner: { start: vi.fn(), get: vi.fn(), advance: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.profile }) }),
    }),
  }),
}));
vi.mock("@/lib/scenario/repository", () => ({
  createPostgresScenarioRepository: () => ({
    get: async (project: string, id: string) => {
      const row = mocks.rows.get(id);
      return row?.projectId === project ? row : null;
    },
    insert: async (row: Scenario) => {
      mocks.rows.set(row.id, row);
      return row;
    },
    list: async () => [...mocks.rows.values()],
    listRuns: mocks.listRuns,
    appendVersion: async (
      project: string,
      id: string,
      patch: Parameters<typeof deriveScenario>[1],
      meta: Parameters<typeof deriveScenario>[2],
    ) => {
      const parent = mocks.rows.get(id)!;
      if (parent.projectId !== project) throw new Error("wrong project");
      const row = deriveScenario(parent, patch, meta);
      mocks.rows.set(row.id, row);
      return row;
    },
  }),
}));
vi.mock("@/lib/evaluation/store-postgres", () => ({
  createPostgresComparisonStore: () => ({ load: mocks.load }),
}));
vi.mock("@/lib/scenario/runtime", () => ({
  createPostgresScenarioRunner: () => mocks.runner,
}));
vi.mock("@/lib/layout/repository", () => ({
  createPostgresLayoutRepository: () => ({ get: mocks.layout }),
}));
vi.mock("@/app/api/sites/inventory", () => ({
  loadSiteInventory: mocks.inventory,
}));
vi.mock("./tools-postgres", () => ({
  createPostgresInvestigationToolDependencies: () => ({
    assemble: mocks.assemble,
    search: mocks.search,
    comparisonForRun: mocks.load,
  }),
}));

function setup() {
  const fixture = createCopilotExample();
  const source = {
    origin: "costar" as const,
    dataset: "invented-test",
    recordId: "test-record",
    field: "space",
  };
  const inventory: SiteInventory = {
    properties: ["Houston", "Los Angeles"].map((city, index) => ({
      id: `property-${index}`,
      city,
      latitude: 29.76,
      longitude: -95.37,
      source,
      data: { buildingName: "PRIVATE_LISTING_TEXT" },
    })),
    spaces: ["new-site", "foreign-city"].map((id, index) => ({
      id,
      listingId: id,
      propertyId: `property-${index}`,
      active: true,
      retail: true,
      sizeSqFt: 100,
      source,
      data: {
        spaceUse: "Retail",
        floor: "Ground",
        askingRentUsdPerSfYearLow: 24,
        askingRentUsdPerSfYearHigh: 24,
        serviceTypeName: "FullService",
      },
    })),
    tenancies: [],
    synthetic: true,
  };
  mocks.inventory.mockResolvedValue(inventory);
  mocks.search.mockImplementation(async (profile, filters) =>
    searchSites({ profile, ...filters }, inventory),
  );
  mocks.rows.set(fixture.scenario.id, fixture.scenario);
  mocks.profile.mockResolvedValue([
    { id: fixture.profile.id, snapshot: fixture.profile },
  ]);
  mocks.listRuns.mockResolvedValue([
    { status: "succeeded", comparisonId: fixture.comparison.id },
  ]);
  mocks.load.mockResolvedValue(fixture.comparison);
  mocks.assemble.mockResolvedValue({
    request: fixture.request,
    assumptions: {},
  });
  const context = {
    projectId: fixture.profile.projectId,
    scenarioId: fixture.scenario.id,
    profileVersion: 1,
    evidenceId: "action-example",
    signal: new AbortController().signal,
    idempotencyKey: "price-action",
  };
  return { ...fixture, context, registry: createPostgresCopilotTools() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
});
describe("production copilot composition", () => {
  it("constructs lazily and registers each business tool exactly once", () => {
    const registry = createPostgresCopilotTools();
    expect(registry.definitions).toHaveLength(14);
    expect(new Set(registry.definitions.map((d) => d.name)).size).toBe(14);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.assemble).not.toHaveBeenCalled();
    expect(mocks.runner.start).not.toHaveBeenCalled();
  });
  it("proposes one price version from cached curves, and retries without another version or provider call", async () => {
    const { registry, scenario, context } = setup();
    const args = {
      scenario_id: scenario.id,
      avg_ticket: 6,
      rationale: "Test cached price acceptance",
    };
    const first = await registry.execute("set_price", args, context);
    expect(first).toMatchObject({
      status: "created",
      priceAcceptance: {
        status: "cached_curve",
        references: [{ siteId: scenario.siteIds[0] }],
      },
    });
    expect(await registry.execute("set_price", args, context)).toEqual(first);
    expect(mocks.rows.size).toBe(2);
    expect(mocks.assemble).not.toHaveBeenCalled();
    expect(mocks.runner.start).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toContain('"value":');
  });
  it("does not invent a dollar conversion or acceptance shift for a tier change", async () => {
    const { registry, scenario, context } = setup();
    const output = await registry.execute(
      "set_price",
      {
        scenario_id: scenario.id,
        tier: "premium",
        rationale: "Compare positioning",
      },
      context,
    );
    expect(output).toMatchObject({
      status: "created",
      priceAcceptance: { status: "tier_requires_run", references: [] },
    });
    if (output.status === "created")
      expect(
        mocks.rows.get(output.scenarioId)?.overrides.averageTicketCents,
      ).toBeUndefined();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.assemble).not.toHaveBeenCalled();
  });
  it("never uses a foreign saved comparison as cached price evidence", async () => {
    const { registry, scenario, context, comparison } = setup();
    comparison.evaluation.request.projectId = "foreign";
    const output = await registry.execute(
      "set_price",
      { scenario_id: scenario.id, avg_ticket: 6, rationale: "Try price" },
      context,
    );
    expect(output).toMatchObject({
      status: "created",
      priceAcceptance: { status: "unavailable", references: [] },
    });
    expect(mocks.assemble).not.toHaveBeenCalled();
  });
  it("routes run through the human approval gate, not the legacy unsupported mutation entry", async () => {
    const { registry, scenario, context } = setup();
    expect(
      await registry.execute(
        "run_scenario",
        { scenario_id: scenario.id },
        context,
      ),
    ).toMatchObject({ status: "needs_confirmation", reason: "human_run" });
    expect(mocks.runner.start).not.toHaveBeenCalled();
  });
  it("checks every site's area without running a scenario or calling a paid panel", async () => {
    const { registry, scenario, context } = setup();
    expect(
      await registry.execute(
        "set_stations",
        { scenario_id: scenario.id, n: 2, rationale: "Add station" },
        context,
      ),
    ).toMatchObject({ code: "CAPACITY_CONFLICT" });
    expect(mocks.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: context.projectId }),
      scenario.siteIds,
      { mode: "huff" },
      context.signal,
    );
    expect(mocks.rows.size).toBe(1);
    expect(mocks.runner.start).not.toHaveBeenCalled();
  });
  it("rejects foreign-profile snapshots before capacity assembly", async () => {
    const { registry, scenario, context, profile } = setup();
    profile.projectId = "foreign";
    expect(
      await registry.execute(
        "set_stations",
        { scenario_id: scenario.id, n: 1, rationale: "Set capacity" },
        context,
      ),
    ).toMatchObject({ status: "rejected" });
    expect(mocks.assemble).not.toHaveBeenCalled();
    expect(mocks.rows.size).toBe(1);
  });
  it("uses existing search with scoped rent and must-have preferences without changing the profile", async () => {
    const { registry, scenario, context, profile } = setup();
    const output = await registry.execute(
      "find_sites",
      {
        scenario_id: scenario.id,
        preferences: {
          rentCeilingCents: 300000,
          minSizeSqFt: 80,
          mustHaves: { parking: false },
        },
      },
      context,
    );
    expect(output).toMatchObject({ status: "found", siteIds: ["new-site"] });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_LISTING_TEXT");
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({
        economics: expect.objectContaining({
          monthlyRentCeilingCents: expect.objectContaining({
            value: 300000,
            origin: "default",
          }),
        }),
      }),
      expect.objectContaining({ minSizeSqFt: 80 }),
      context.signal,
    );
    expect(profile.economics.monthlyRentCeilingCents.value).toBe(400000);
    expect(mocks.assemble).not.toHaveBeenCalled();
  });
  it("validates shortlisted IDs against the saved project's city and rejects unknown inventory", async () => {
    const { registry, scenario, context } = setup();
    for (const site of ["unknown", "foreign-city"]) {
      expect(
        await registry.execute(
          "add_sites",
          {
            scenario_id: scenario.id,
            site_ids: [site],
            rationale: "Consider another site",
          },
          context,
        ),
      ).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(mocks.rows.size).toBe(1);
    expect(
      await registry.execute(
        "add_sites",
        {
          scenario_id: scenario.id,
          site_ids: ["new-site"],
          rationale: "Consider this verified site",
        },
        context,
      ),
    ).toMatchObject({ status: "created" });
    expect(mocks.rows.size).toBe(2);
    expect(mocks.assemble).not.toHaveBeenCalled();
  });
});
