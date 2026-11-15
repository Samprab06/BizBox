import { describe, expect, it } from "vitest";
import { UiActionSchema, type UiAction } from "@/lib/contracts/agent";
import { fixtureUiLookups, UI_FIXTURE } from "./__fixtures__/scripted-model";
import {
  createUiToolExecutor,
  ruleBasedUiActions,
  UI_TOOL_NAMES,
  UI_TOOL_SPECS,
  type IntakeUiLookups,
} from "./ui-tools";

function executor(
  lookups: IntakeUiLookups = fixtureUiLookups(),
  city?: string,
) {
  const actions: UiAction[] = [];
  let n = 0;
  const run = createUiToolExecutor(
    {
      projectId: UI_FIXTURE.projectId,
      lookups,
      actions,
      newId: () => `ui_${++n}`,
    },
    () => city,
  );
  return { run, actions };
}

describe("HAC-144 UI tool executor", () => {
  it("exposes one model-facing schema per tool, without server-owned id or type", () => {
    expect(UI_TOOL_SPECS.map((spec) => spec.name)).toEqual(UI_TOOL_NAMES);
    for (const spec of UI_TOOL_SPECS) {
      const properties = Object.keys(
        (spec.schema.properties ?? {}) as Record<string, unknown>,
      );
      expect(properties).not.toContain("id");
      expect(properties).not.toContain("type");
    }
  });

  it("queues contract-valid actions for verified IDs", async () => {
    const { run, actions } = executor(fixtureUiLookups(), "Houston");
    expect(
      await run("open_simulator", {
        comparisonId: UI_FIXTURE.comparisonId,
        siteId: UI_FIXTURE.heightsSiteId,
      }),
    ).toMatch(/^Queued/);
    expect(
      await run("show_comparison", {
        investigationId: UI_FIXTURE.investigationId,
      }),
    ).toMatch(/^Queued/);
    expect(
      await run("open_interior", {
        siteId: UI_FIXTURE.montroseSiteId,
        minute: 480,
      }),
    ).toMatch(/^Queued/);
    expect(actions).toHaveLength(3);
    for (const action of actions) UiActionSchema.parse(action);
    expect(actions[0]).toEqual({
      id: "ui_1",
      type: "open_simulator",
      comparisonId: UI_FIXTURE.comparisonId,
      siteId: UI_FIXTURE.heightsSiteId,
    });
  });

  it("rejects unknown, cross-project and other-city IDs", async () => {
    const { run, actions } = executor(fixtureUiLookups(), "Houston");
    const results = await Promise.all([
      run("open_site", { siteId: "L-spoof:S-0" }),
      run("open_site", { siteId: UI_FIXTURE.losAngelesSiteId }),
      run("show_plan", { comparisonId: UI_FIXTURE.foreignComparisonId }),
      run("show_comparison", { investigationId: "inv_foreign" }),
      run("show_step", {
        stage: "comparison",
        comparisonId: "cmp_spoof",
      }),
    ]);
    expect(results.every((text) => text.startsWith("Error:"))).toBe(true);
    expect(actions).toEqual([]);
  });

  it("ignores the model's own id/type and rejects extra fields", async () => {
    const { run, actions } = executor();
    expect(
      await run("highlight", { target: "map", id: "spoof", type: "open_site" }),
    ).toMatch(/^Queued/);
    expect(actions).toEqual([{ id: "ui_1", type: "highlight", target: "map" }]);
    expect(
      await run("highlight", { target: "assumptions", selector: "#x" }),
    ).toMatch(/^Error: invalid highlight/);
  });

  it("caps a turn at three actions, including parallel calls, and skips duplicates", async () => {
    const { run, actions } = executor();
    expect(await run("highlight", { target: "map" })).toMatch(/^Queued/);
    expect(await run("highlight", { target: "map" })).toMatch(
      /^Already queued/,
    );
    const results = await Promise.all([
      run("open_site", { siteId: UI_FIXTURE.montroseSiteId }),
      run("open_site", { siteId: UI_FIXTURE.heightsSiteId }),
      run("focus_map", { siteIds: [UI_FIXTURE.montroseSiteId] }),
    ]);
    expect(actions).toHaveLength(3);
    expect(results.filter((text) => text.includes("limit (3)"))).toHaveLength(
      1,
    );
  });

  it("reports a failed lookup without throwing or queueing", async () => {
    const broken: IntakeUiLookups = {
      site: async () => {
        throw new Error("postgres://secret@db down");
      },
      comparisonExists: async () => true,
      investigationExists: async () => true,
    };
    const { run, actions } = executor(broken);
    const text = await run("open_site", { siteId: UI_FIXTURE.montroseSiteId });
    expect(text).toContain("could not be verified");
    expect(text).not.toContain("secret");
    expect(actions).toEqual([]);
  });

  it("looks each ID up once per turn", async () => {
    const lookups = fixtureUiLookups();
    const { run } = executor(lookups);
    await run("open_site", { siteId: UI_FIXTURE.montroseSiteId });
    await run("open_interior", { siteId: UI_FIXTURE.montroseSiteId });
    expect(lookups.calls).toEqual([`site:${UI_FIXTURE.montroseSiteId}`]);
  });
});

describe("HAC-144 rule-based fallback", () => {
  const newId = () => "ui_rule";
  it("moves a newly completed profile to the spaces (map) step only once", () => {
    expect(
      ruleBasedUiActions({ wasComplete: false, isComplete: true, newId }),
    ).toEqual([{ id: "ui_rule", type: "navigate", stage: "map" }]);
    expect(
      ruleBasedUiActions({ wasComplete: true, isComplete: true, newId }),
    ).toEqual([]);
    expect(
      ruleBasedUiActions({ wasComplete: false, isComplete: false, newId }),
    ).toEqual([]);
  });
});
