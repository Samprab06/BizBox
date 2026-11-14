import { AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { describe, expect, it, vi } from "vitest";
import type { Scenario } from "@/lib/contracts/scenario";
import type { ScenarioRepository } from "@/lib/scenario/repository";
import { createScenarioService } from "@/lib/scenario/service";
import { deriveScenario } from "@/lib/scenario/model";
import { buildScenarioPatch } from "@/lib/scenario/patch";
import {
  CopilotMutationResultSchema,
  type CopilotMutationToolName,
  type CopilotMutationResult,
} from "@/lib/contracts/copilot-tools";
import {
  createCopilotMutationTools,
  type CopilotMutationDependencies,
} from "./copilot-tools";

class ScriptedModel extends BaseChatModel {
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "copilot-offline-test";
  }
  bindTools() {
    return this;
  }
  async _generate() {
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected extra model invocation");
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

async function setup(
  overrides: Scenario["overrides"] = {},
  layoutId: string | null = null,
) {
  const rows = new Map<string, Scenario>();
  const repository = {
    async insert(row: Scenario) {
      rows.set(row.id, row);
      return row;
    },
    async get(projectId: string, id: string) {
      const row = rows.get(id);
      return row?.projectId === projectId ? row : null;
    },
    async list(projectId: string) {
      return [...rows.values()].filter((row) => row.projectId === projectId);
    },
    async appendVersion(projectId, parentId, patch, meta) {
      const parent = await this.get(projectId, parentId);
      if (!parent) throw new Error("No parent");
      return this.insert(deriveScenario(parent, patch, meta));
    },
  } satisfies Pick<
    ScenarioRepository,
    "insert" | "get" | "list" | "appendVersion"
  >;
  let id = 0;
  const service = createScenarioService({
    repository,
    newId: () => `s${++id}`,
    now: () => new Date("2026-11-14T00:00:00Z"),
  });
  const parent = await service.create("p1", {
    siteIds: ["1:1", "2:1"],
    profileVersion: 1,
    label: "Baseline",
    overrides,
    layoutId,
  });
  const create = vi.fn(service.create);
  const capacity = vi.fn<
    NonNullable<CopilotMutationDependencies["stationCapacity"]>
  >(async (_project, scenario) =>
    scenario.siteIds.map((siteId) => ({
      siteId,
      maxStations: 5,
      layoutId: scenario.layoutId,
      evidenceIds: ["listing-sf"],
    })),
  );
  const inventory = new Set(["1:1", "2:1", "3:1"]);
  const validateCandidates = vi.fn<
    NonNullable<CopilotMutationDependencies["validateCandidates"]>
  >(async (_project, ids) => ({
    candidateIds: ids.filter((id) => inventory.has(id)),
    evidenceIds: ["current-listing-search"],
  }));
  const registry = createCopilotMutationTools({
    scenarios: { get: service.get, create },
    stationCapacity: capacity,
    validateCandidates,
    priceAcceptance: async (_project, scenario, change) => ({
      comparisonId: change.kind === "price" ? "comparison-cached" : null,
      siteIds: change.kind === "price" ? scenario.siteIds : [],
      status: change.kind === "price" ? "cached_curve" : "tier_requires_run",
    }),
  });
  const context = {
    projectId: "p1",
    evidenceId: "copilot-action",
    signal: new AbortController().signal,
  };
  return { parent, service, rows, registry, create, capacity, context };
}

const cases: {
  name: CopilotMutationToolName;
  args: Record<string, unknown>;
  status: "created" | "unsupported";
}[] = [
  {
    name: "fork_scenario",
    args: {
      from_id: "s1",
      label: "Alternative",
      rationale: "Try another scenario",
    },
    status: "created",
  },
  {
    name: "set_hours",
    args: {
      scenario_id: "s1",
      day_type: "weekday",
      open: 360,
      close: 1080,
      rationale: "Serve early commuters",
    },
    status: "created",
  },
  {
    name: "set_staffing",
    args: { scenario_id: "s1", headcount: 3, rationale: "Reduce the queue" },
    status: "created",
  },
  {
    name: "set_stations",
    args: {
      scenario_id: "s1",
      n: 3,
      rationale: "Add capacity within the known floor area",
    },
    status: "created",
  },
  {
    name: "add_sites",
    args: {
      scenario_id: "s1",
      site_ids: ["3:1"],
      rationale: "Compare an additional known candidate",
    },
    status: "created",
  },
  {
    name: "remove_sites",
    args: {
      scenario_id: "s1",
      site_ids: ["2:1"],
      rationale: "Keep the preferred candidate",
    },
    status: "created",
  },
  {
    name: "set_price",
    args: {
      scenario_id: "s1",
      avg_ticket: 7.8,
      rationale: "Explore a higher average ticket",
    },
    status: "created",
  },
  {
    name: "edit_layout",
    args: {
      scenario_id: "s1",
      ops: [{ op: "remove", elementId: "chair-2" }],
      rationale: "Make space for the queue",
    },
    status: "unsupported",
  },
  { name: "run_scenario", args: { scenario_id: "s1" }, status: "unsupported" },
];

describe("copilot tools with an offline scripted deepagents model", () => {
  it.each(cases)(
    "$name creates one version or explicitly refuses a missing adapter",
    async ({ name, args, status }) => {
      const { parent, rows, registry, create, context } = await setup();
      let output: CopilotMutationResult | undefined;
      const model = new ScriptedModel([
        new AIMessage({
          content: "",
          tool_calls: [{ id: "action", name, args }],
        }),
        new AIMessage("The tool result is available for review."),
      ]);
      const agent = createDeepAgent({
        model,
        tools: registry.definitions.map((definition) =>
          tool(
            async (args: unknown) => {
              output = await registry.execute(definition.name, args, context);
              return JSON.stringify(output);
            },
            {
              name: definition.name,
              description: definition.description,
              schema: definition.schema,
            },
          ),
        ),
        middleware: [
          { name: "FilesystemMiddleware", tools: [] },
          { name: "subAgentMiddleware", tools: [] },
        ],
      });
      await agent.invoke(
        {
          messages: [{ role: "user", content: "Apply this scenario action." }],
        },
        { recursionLimit: 10 },
      );
      expect(CopilotMutationResultSchema.parse(output).status).toBe(status);
      expect(rows.size).toBe(status === "created" ? 2 : 1);
      expect(create).toHaveBeenCalledTimes(status === "created" ? 1 : 0);
      if (output?.status === "created") {
        const child = rows.get(output.scenarioId)!;
        expect(child.author).toBe("agent");
        expect(child.rationale).toBe(args.rationale);
        expect(child.parentId).toBe(parent.id);
        expect(rows.get(parent.id)).toEqual(parent);
        expect(JSON.stringify(output)).not.toContain('"value":');
        expect(JSON.stringify(output)).not.toContain('"events":');
      }
    },
  );
});

describe("mutation boundaries", () => {
  it.each([
    { index: 0, change: { kind: "fork", label: "Alternative" } },
    {
      index: 1,
      change: {
        kind: "hours",
        dayType: "weekday",
        openMinute: 360,
        closeMinute: 1080,
      },
    },
    { index: 2, change: { kind: "staffing", headcount: 3 } },
    { index: 3, change: { kind: "stations", count: 3 } },
    { index: 4, change: { kind: "add_sites", siteIds: ["3:1"] } },
    { index: 5, change: { kind: "remove_sites", siteIds: ["2:1"] } },
    { index: 6, change: { kind: "price", averageTicketCents: 780 } },
  ])(
    "matches the manual shared-service semantics for $change.kind",
    async ({ index, change }) => {
      const { parent, registry, service, rows, context } = await setup();
      const output = await registry.execute(
        cases[index].name,
        cases[index].args,
        context,
      );
      if (output.status !== "created") throw new Error("Expected proposal");
      const manual = await service.create(context.projectId, {
        fromId: parent.id,
        patch: buildScenarioPatch(parent, change, {
          origin: "default",
          evidenceIds: [context.evidenceId],
        }),
        author: "founder",
      });
      const child = rows.get(output.scenarioId)!;
      expect({
        overrides: child.overrides,
        label: child.label,
        layoutId: child.layoutId,
        siteIds: child.siteIds,
        profileVersion: child.profileVersion,
      }).toEqual({
        overrides: manual.overrides,
        label: manual.label,
        layoutId: manual.layoutId,
        siteIds: manual.siteIds,
        profileVersion: manual.profileVersion,
      });
    },
  );

  it("replays one accepted action and rejects conflicting reuse of the action key", async () => {
    const { registry, context, rows } = await setup();
    const scoped = {
      ...context,
      scenarioId: "s1",
      profileVersion: 1,
      idempotencyKey: "same-action",
    };
    const first = await registry.execute("set_hours", cases[1].args, scoped);
    expect(first.status).toBe("created");
    expect(await registry.execute("set_hours", cases[1].args, scoped)).toEqual(
      first,
    );
    expect(rows.size).toBe(2);
    expect(
      await registry.execute("set_staffing", cases[2].args, scoped),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(rows.size).toBe(2);
  });

  it("rejects stale scenario/profile snapshots before creating a proposal", async () => {
    const { registry, context, create } = await setup();
    for (const stale of [{ scenarioId: "another" }, { profileVersion: 2 }]) {
      expect(
        await registry.execute("set_hours", cases[1].args, {
          ...context,
          ...stale,
        }),
      ).toMatchObject({ code: "STALE_CONTEXT" });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects fractional-cent prices and missing repricing adapters without creating versions", async () => {
    const { registry, service, context, rows } = await setup();
    expect(
      await registry.execute(
        "set_price",
        { ...cases[6].args, avg_ticket: 7.001 },
        context,
      ),
    ).toMatchObject({ code: "INVALID_INPUT" });
    const noPrice = createCopilotMutationTools({ scenarios: service });
    expect(
      await noPrice.execute("set_price", cases[6].args, context),
    ).toMatchObject({ status: "unsupported" });
    expect(rows.size).toBe(1);
  });
  it("validates cached adapter receipts before creating any scenario version", async () => {
    const { service, context, rows } = await setup();
    const registry = createCopilotMutationTools({
      scenarios: service,
      priceAcceptance: async () => ({
        status: "unavailable",
        comparisonId: null,
        siteIds: [],
        rawMetric: 42,
      }),
    });
    expect(
      await registry.execute("set_price", cases[6].args, context),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(rows.size).toBe(1);
  });

  it("matches the shared service path with identical declared provenance", async () => {
    const { parent, registry, service, rows, context } = await setup();
    const output = await registry.execute("set_hours", cases[1].args, context);
    expect(output.status).toBe("created");
    if (output.status !== "created")
      throw new Error("Expected created version");
    const expected = await service.create("p1", {
      fromId: parent.id,
      patch: buildScenarioPatch(
        parent,
        {
          kind: "hours",
          dayType: "weekday",
          openMinute: 360,
          closeMinute: 1080,
        },
        { origin: "default", evidenceIds: [context.evidenceId] },
      ),
      author: "founder",
    });
    const child = rows.get(output.scenarioId)!;
    expect(child.overrides).toEqual(expected.overrides);
    expect(child.siteIds).toEqual(expected.siteIds);
    expect(child.profileVersion).toEqual(expected.profileVersion);
  });

  it("keeps inherited founder wrappers intact on agent proposals", async () => {
    const original = {
      value: 2,
      unit: "people",
      origin: "founder" as const,
      evidenceIds: ["founder-answer"],
    };
    const { parent, rows, registry, context } = await setup({
      staffHeadcount: original,
    });
    const output = await registry.execute("set_hours", cases[1].args, context);
    expect(output).toMatchObject({
      status: "created",
    });
    expect(rows.size).toBe(2);
    expect(parent.overrides.staffHeadcount).toEqual(original);
    if (output.status === "created")
      expect(rows.get(output.scenarioId)?.overrides.staffHeadcount).toEqual(
        original,
      );
  });

  it("rejects scope changes, invalid arguments, empty shortlists and unsupported hourly staffing before writes", async () => {
    const { registry, context, rows, create } = await setup();
    expect(
      await registry.execute(
        "set_staffing",
        { ...cases[2].args, projectId: "p2" },
        context,
      ),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await registry.execute("set_staffing", cases[2].args, {
        ...context,
        projectId: "p2",
      }),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(
      await registry.execute(
        "remove_sites",
        { ...cases[5].args, site_ids: ["1:1", "2:1"] },
        context,
      ),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await registry.execute(
        "set_staffing",
        {
          scenario_id: "s1",
          rationale: "Lunch",
          by_hour: [{ open: 660, close: 840, headcount: 3 }],
        },
        context,
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(create).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);
  });

  it("rejects invented candidate IDs and absent inventory validation without a version", async () => {
    const { registry, service, context, rows, create } = await setup();
    expect(
      await registry.execute(
        "add_sites",
        { ...cases[4].args, site_ids: ["9:1"] },
        context,
      ),
    ).toMatchObject({ code: "INVALID_INPUT" });
    const noInventory = createCopilotMutationTools({ scenarios: service });
    expect(
      await noInventory.execute("add_sites", cases[4].args, context),
    ).toMatchObject({ status: "unsupported" });
    expect(create).not.toHaveBeenCalled();
    expect(rows.size).toBe(1);
  });

  it("requires station count to agree with the selected layout and checks cancellation after capacity lookup", async () => {
    const { registry, capacity, context, create } = await setup({}, "layout-1");
    const capacities = ["1:1", "2:1"].map((siteId, index) => ({
      siteId,
      maxStations: 5,
      layoutId: index === 0 ? "layout-1" : null,
      layoutStations: 2,
      evidenceIds: ["layout-geometry"],
    }));
    capacity.mockResolvedValue(capacities);
    expect(
      await registry.execute("set_stations", cases[3].args, context),
    ).toMatchObject({ code: "CAPACITY_CONFLICT" });
    const controller = new AbortController();
    capacity.mockImplementation(async () => {
      controller.abort();
      return capacities;
    });
    await expect(
      registry.execute(
        "set_stations",
        { ...cases[3].args, n: 2 },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    capacity.mockResolvedValue(capacities);
    expect(
      await registry.execute(
        "set_stations",
        { ...cases[3].args, n: 2 },
        context,
      ),
    ).toMatchObject({ status: "created" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("validates every selected site's floor area and requires selected layout agreement", async () => {
    const { registry, context, capacity, create } = await setup();
    expect(
      await registry.execute(
        "set_stations",
        { ...cases[3].args, n: 6 },
        context,
      ),
    ).toMatchObject({ code: "CAPACITY_CONFLICT" });
    capacity.mockResolvedValue([
      { siteId: "1:1", maxStations: 5, layoutId: null, evidenceIds: ["sf"] },
    ]);
    expect(
      await registry.execute("set_stations", cases[3].args, context),
    ).toMatchObject({ code: "CAPACITY_CONFLICT" });
    capacity.mockResolvedValue([
      {
        siteId: "1:1",
        maxStations: 5,
        layoutId: "another-layout",
        evidenceIds: ["sf"],
      },
      {
        siteId: "2:1",
        maxStations: 5,
        layoutId: "another-layout",
        evidenceIds: ["sf"],
      },
    ]);
    expect(
      await registry.execute("set_stations", cases[3].args, context),
    ).toMatchObject({ code: "CAPACITY_CONFLICT" });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not write without a capacity adapter or after cancellation, and sanitizes service failures", async () => {
    const { service, context, create, registry, rows } = await setup();
    const noCapacity = createCopilotMutationTools({ scenarios: service });
    expect(
      await noCapacity.execute("set_stations", cases[3].args, context),
    ).toMatchObject({ status: "unsupported" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      registry.execute("set_staffing", cases[2].args, {
        ...context,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    create.mockRejectedValue(new Error("postgres://secret-driver-detail"));
    const failure = await registry.execute(
      "set_staffing",
      cases[2].args,
      context,
    );
    expect(failure).toMatchObject({ code: "UNAVAILABLE" });
    expect(JSON.stringify(failure)).not.toContain("secret");
    expect(rows.size).toBe(1);
  });
});
