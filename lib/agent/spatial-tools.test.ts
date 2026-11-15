import { describe, expect, it } from "vitest";
import { createSpatialDraft } from "@/lib/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import type { IntakeUiContext } from "./ui-tools";
import { createSpatialToolExecutor, SPATIAL_TOOL_SPECS } from "./spatial-tools";

function setup(overrides: Partial<IntakeUiContext> = {}) {
  const draft = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const context: IntakeUiContext = {
    projectId: "p",
    actions: [],
    newId: () => "action-1",
    lookups: {
      site: async () => ({ city: "Houston" }),
      comparisonExists: async () => true,
      investigationExists: async () => false,
    },
    view: {
      stage: "interior",
      siteId: "s",
      comparisonId: "c",
      spatial: { comparisonId: "c", baseline: draft, draft, reviewed: false },
    },
    ...overrides,
  };
  return { context, run: createSpatialToolExecutor(context) };
}

describe("FDE spatial tools", () => {
  it("offers catalog and current capability/readiness without inventing provider evidence", async () => {
    const { run, context } = setup();
    expect(SPATIAL_TOOL_SPECS.map((s) => s.name)).toContain("edit_interior");
    const catalog = JSON.parse(await run("read_furniture_catalog", {}));
    expect(catalog.items[0].id).toBe(FURNITURE_CATALOG[0]!.id);
    const state = JSON.parse(await run("read_interior_experiment", {}));
    expect(state.behaviorSource).toBe("assumed");
    expect(context.actions).toEqual([]);
  });
  it("validates and previews edits and queues a scoped action", async () => {
    const { run, context } = setup();
    const response = await run("edit_interior", {
      siteId: "s",
      command: { type: "clear" },
    });
    expect(response).not.toMatch(/^Error:/);
    expect(context.actions[0]).toMatchObject({
      type: "spatial_edit",
      siteId: "s",
      command: { type: "clear" },
    });
  });
  it("rejects foreign project, site and comparison drafts", async () => {
    for (const kind of ["project", "site", "comparison"] as const) {
      const { context } = setup();
      const spatial = context.view!.spatial!;
      if (kind === "project") spatial.draft.projectId = "foreign";
      if (kind === "site") spatial.draft.siteId = "foreign";
      if (kind === "comparison") spatial.comparisonId = "foreign";
      const run = createSpatialToolExecutor(context);
      expect(await run("run_interior_experiment", { siteId: "s" })).toMatch(
        /^Error:/,
      );
      expect(context.actions).toEqual([]);
    }
  });
  it("fails closed without a saved owned exterior comparison", async () => {
    const { run, context } = setup({
      lookups: {
        site: async () => ({ city: "Houston" }),
        comparisonExists: async () => false,
        investigationExists: async () => false,
      },
    });
    expect(
      await run("edit_interior", { siteId: "s", command: { type: "clear" } }),
    ).toMatch(/^Error:/);
    expect(context.actions).toEqual([]);
  });
  it("does not claim an invalid placement was queued", async () => {
    const { run, context } = setup();
    expect(
      await run("edit_interior", {
        siteId: "s",
        command: {
          type: "add",
          catalogId: "nonexistent",
          id: "x",
          x: 0,
          z: 0,
          rotation: 0,
        },
      }),
    ).toMatch(/^Error:/);
    expect(context.actions).toEqual([]);
  });
});

it("serializes concurrent furniture edits against the latest validated draft", async () => {
  const { run, context } = setup();
  const command = {
    type: "add",
    catalogId: FURNITURE_CATALOG[0]!.id,
    id: "one",
    x: 2,
    z: 3,
    rotation: 0,
  };
  const responses = await Promise.all([
    run("edit_interior", { siteId: "s", command }),
    run("edit_interior", { siteId: "s", command: { ...command, id: "two" } }),
  ]);
  expect(responses[0]).not.toMatch(/^Error:/);
  expect(responses[1]).toMatch(/^Error:/);
  expect(context.actions).toHaveLength(1);
});

it("reads the defined reference case and queues a scoped counter selection", async () => {
  const { run, context } = setup();
  const read = JSON.parse(await run("read_reference_cafe", {}));
  expect(read.modelId).toBe("qfmMbTLt4Bo");
  expect(read.plans[1].served).toBe(80);
  expect(
    await run("set_reference_cafe", {
      siteId: "s",
      selectedPlan: 1,
      reviewed: true,
    }),
  ).not.toMatch(/^Error:/);
  expect(context.actions[0]).toMatchObject({
    type: "set_reference_cafe",
    siteId: "s",
    comparisonId: "c",
    selectedPlan: 1,
    reviewed: true,
  });
});

it("reads a just-queued reference selection within the same FDE turn", async () => {
  const { run, context } = setup();
  await run("set_reference_cafe", {
    siteId: "s",
    selectedPlan: 1,
    reviewed: false,
  });
  const read = JSON.parse(await run("read_reference_cafe", {}));
  expect(read.current).toEqual({
    modelId: "qfmMbTLt4Bo",
    selectedPlan: 1,
    reviewed: false,
  });
  expect(context.actions[0]).toMatchObject({ expectedReference: null });
});

it("uses selected source and refuses applying reference controls to it", async () => {
  const { context } = setup();
  context.view!.spatial!.source = {
    kind: "modeled",
    provenance: {
      origin: "default",
      provider: "modeled",
      mode: "live",
      scope: "space",
      description: "Selected-building fallback",
      limitations: [],
    },
  };
  const run = createSpatialToolExecutor(context);
  const read = JSON.parse(await run("read_interior_experiment", {}));
  expect(read.interiorSource.provenance.description).toBe(
    "Selected-building fallback",
  );
  expect(
    await run("set_reference_cafe", {
      siteId: "s",
      selectedPlan: 1,
      reviewed: true,
    }),
  ).toMatch(/^Error:/);
  expect(context.actions).toEqual([]);
  expect(
    await run("edit_interior", {
      siteId: "s",
      command: {
        type: "layout",
        entrance: { x: 1, z: 0.5 },
        servicePoint: { x: 8, z: 7 },
      },
    }),
  ).not.toMatch(/^Error:/);
  expect(context.actions[0]).toMatchObject({
    type: "spatial_edit",
    command: { type: "layout" },
  });
});

import { getSpatialPolicyStates } from "@/lib/spatial";
it("does not report browser-supplied policy labels as genuine Jev without server verification", async () => {
  const { context } = setup();
  const draft = context.view!.spatial!.draft;
  const policy = {
    source: "jev" as const,
    modelVersion: "claimed-model",
    evidenceId: "claimed-evidence",
    states: getSpatialPolicyStates(draft).map((state) => ({
      ...state,
      stayByQueue: [{ lineLength: 0, p: 0.5 }],
    })),
  };
  context.view!.spatial!.policies = { baseline: policy, variant: policy };
  const run = createSpatialToolExecutor(context);
  expect(await run("read_interior_experiment", {})).toMatch(
    /^Error:.*verified/,
  );
  context.view!.spatial!.policyReceipt = {
    version: 1,
    digest: "a".repeat(64),
    signature: "b".repeat(64),
  };
  context.verifyInteriorPolicies = async () => true;
  expect(
    JSON.parse(
      await createSpatialToolExecutor(context)("read_interior_experiment", {}),
    ).behaviorSource,
  ).toBe("jev");
});

it("queues one high-level controlled experiment without claiming a finished run", async () => {
  const { context, run } = setup();
  const reply = JSON.parse(
    await run("test_interior_change", {
      siteId: "s",
      catalogId: "round_wooden_table_02",
      question: "Test one table",
    }),
  );
  expect(reply.queued).toBe(true);
  expect(reply.completed).toBe(false);
  expect(context.actions).toHaveLength(1);
  expect(context.actions[0]).toMatchObject({
    type: "propose_interior_experiment",
    siteId: "s",
    comparisonId: "c",
    draftId: context.view!.spatial!.draft.id,
    expectedRevision: 0,
    catalogId: "round_wooden_table_02",
  });
  expect(context.view!.spatial!.draft.items).toHaveLength(0);
});
it("rejects controlled experiment catalog invention or wrong site", async () => {
  const { context, run } = setup();
  expect(
    await run("test_interior_change", {
      siteId: "s",
      catalogId: "invented",
      question: "Test",
    }),
  ).toMatch(/^Error:/);
  expect(
    await run("test_interior_change", {
      siteId: "other",
      catalogId: "round_wooden_table_02",
      question: "Test",
    }),
  ).toMatch(/^Error:/);
  expect(context.actions).toHaveLength(0);
});

it("does not describe recomputed preview as a completed controlled finding", async () => {
  const { run } = setup();
  const response = JSON.parse(await run("read_interior_experiment", {}));
  expect(response.status).toBe("preview");
  expect(response.controlledFinding).toBeNull();
});
