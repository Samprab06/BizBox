import { describe, expect, it } from "vitest";
import { createScenarioService } from "./service";
import type { Scenario } from "@/lib/contracts/scenario";
import type { ScenarioRepository } from "./repository";
import { deriveScenario } from "./model";

function setup() {
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
  return {
    rows,
    service: createScenarioService({
      repository,
      newId: () => `scenario-${++next}`,
      now: () => new Date("2026-11-14T17:00:00.000Z"),
    }),
  };
}

const root = { siteIds: ["2:1", "1:1"], profileVersion: 1, label: "Baseline" };

describe("scenario history service", () => {
  it("creates scoped roots and forks without changing the parent", async () => {
    const { service } = setup();
    const base = await service.create("p1", root);
    const child = await service.create("p1", {
      fromId: base.id,
      patch: { label: "Alternative" },
    });
    expect(base.siteIds).toEqual(["1:1", "2:1"]);
    expect(child).toMatchObject({
      parentId: base.id,
      label: "Alternative",
      author: "founder",
    });
    expect((await service.get("p1", base.id)).label).toBe("Baseline");
    expect(
      (await service.list("p1")).map((n) => [n.scenario.id, n.children]),
    ).toEqual([
      [base.id, [child.id]],
      [child.id, []],
    ]);
  });

  it("revert creates a new version equal to the target, retaining history", async () => {
    const { service } = setup();
    const base = await service.create("p1", root);
    const alternative = await service.create("p1", {
      fromId: base.id,
      patch: { label: "Alternative", siteIds: ["3:1"] },
    });
    const reverted = await service.revert("p1", alternative.id, {
      targetId: base.id,
    });
    expect(reverted).toMatchObject({
      parentId: alternative.id,
      siteIds: base.siteIds,
      overrides: base.overrides,
      label: base.label,
    });
    expect(new Set([base.id, alternative.id, reverted.id]).size).toBe(3);
    expect(await service.list("p1")).toHaveLength(3);
  });

  it("never reads, forks, diffs or reverts another project's history", async () => {
    const { service } = setup();
    const a = await service.create("p1", root);
    const b = await service.create("p2", root);
    await expect(service.get("p2", a.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service.create("p2", { fromId: a.id, patch: {} }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(service.diff("p1", a.id, b.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service.revert("p1", a.id, { targetId: b.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects unknown patch fields and agent changes that claim founder provenance", async () => {
    const { service } = setup();
    const a = await service.create("p1", root);
    await expect(
      service.create("p1", { fromId: a.id, patch: { projectId: "p2" } }),
    ).rejects.toThrow();
    await expect(
      service.create("p1", {
        fromId: a.id,
        author: "agent",
        rationale: "Test staffing",
        patch: {
          overrides: {
            staffHeadcount: {
              value: 3,
              unit: "people",
              origin: "founder",
              evidenceIds: ["e1"],
            },
          },
        },
      }),
    ).rejects.toThrow(/founder/);
  });

  it("returns field-level changes through the existing scenario diff", async () => {
    const { service } = setup();
    const a = await service.create("p1", root);
    const b = await service.create("p1", {
      fromId: a.id,
      patch: { label: "Variant", siteIds: ["3:1"] },
    });
    const diff = await service.diff("p1", a.id, b.id);
    expect(diff.sites).toEqual({ added: ["3:1"], removed: ["1:1", "2:1"] });
    expect(diff.scalars).toContainEqual({
      field: "label",
      from: "Baseline",
      to: "Variant",
    });
  });
});
