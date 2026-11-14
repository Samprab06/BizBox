import { describe, expect, it, vi } from "vitest";
import { createScenarioService } from "./service";
import type { Scenario } from "@/lib/contracts/scenario";
import type { ScenarioRepository } from "./repository";
import { deriveScenario } from "./model";

function setup() {
  const rows = new Map<string, Scenario>();
  const repository = {
    async insert(s: Scenario) {
      if (rows.has(s.id))
        throw Object.assign(new Error("duplicate"), { code: "23505" });
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
  const restart = () =>
    createScenarioService({
      repository,
      newId: () => `scenario-${++next}`,
      now: () => new Date("2026-11-15T17:00:00.000Z"),
    });
  return {
    rows,
    repository,
    restart,
    service: createScenarioService({
      repository,
      newId: () => `scenario-${++next}`,
      now: () => new Date("2026-11-14T17:00:00.000Z"),
    }),
  };
}

const root = { siteIds: ["2:1", "1:1"], profileVersion: 1, label: "Baseline" };

describe("scenario history service", () => {
  it("reuses durable scoped UUID identities after a service restart without persisting raw keys", async () => {
    const { service, restart, rows } = setup();
    const options = { idempotencyKey: "secret-operation-key" };
    const first = await service.create("p1", root, options);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      await restart().create(
        "p1",
        { ...root, siteIds: ["1:1", "2:1"] },
        options,
      ),
    ).toEqual(first);
    const anotherProject = await service.create("p2", root, options);
    expect(anotherProject.id).not.toBe(first.id);
    expect(rows.size).toBe(2);
    expect(JSON.stringify([...rows.values()])).not.toContain(
      options.idempotencyKey,
    );
  });

  it("recovers simultaneous child insert uniqueness races with one durable version", async () => {
    const { service, restart, rows, repository } = setup();
    const base = await service.create("p1", root);
    const input = {
      fromId: base.id,
      patch: { label: "Concurrent" },
      author: "agent",
      rationale: "Test retry",
    };
    const append = vi.spyOn(repository, "appendVersion");
    const options = { idempotencyKey: "same-action" };
    const [a, b] = await Promise.all([
      service.create("p1", input, options),
      restart().create("p1", input, options),
    ]);
    expect(a).toEqual(b);
    expect(append).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(2);
    expect(await restart().create("p1", input, options)).toEqual(a);
  });

  it("rejects key reuse for a different semantic request or author", async () => {
    const { service, restart, rows } = setup();
    const base = await service.create("p1", root);
    const input = {
      fromId: base.id,
      patch: { label: "Retry" },
      author: "agent",
      rationale: "reason",
    };
    const options = { idempotencyKey: "one" };
    await service.create("p1", input, options);
    for (const changed of [
      { ...input, patch: { label: "Different" } },
      { ...input, author: "founder" },
      { ...input, rationale: "Different" },
      root,
    ])
      await expect(
        restart().create("p1", changed, options),
      ).rejects.toMatchObject({ code: "invalid" });
    expect(rows.size).toBe(2);
  });

  it("does not hide unrelated write errors or uniqueness errors without a matching row", async () => {
    const { service, repository } = setup();
    const error = new Error("connection lost");
    vi.spyOn(repository, "insert").mockRejectedValueOnce(error);
    await expect(
      service.create("p1", root, { idempotencyKey: "failure" }),
    ).rejects.toBe(error);
    const duplicate = Object.assign(new Error("other unique constraint"), {
      code: "23505",
    });
    vi.spyOn(repository, "insert").mockRejectedValueOnce(duplicate);
    await expect(
      service.create("p1", root, { idempotencyKey: "failure" }),
    ).rejects.toBe(duplicate);
  });

  it("preserves founder values and shares manual/agent change semantics apart from authorship", async () => {
    const { service } = setup();
    const base = await service.create("p1", {
      ...root,
      overrides: {
        staffHeadcount: {
          value: 2,
          unit: "people",
          origin: "founder",
          evidenceIds: ["founder-answer"],
        },
      },
    });
    const patch = {
      overrides: {
        ...base.overrides,
        plannedStations: {
          value: 3,
          unit: "stations",
          origin: "default",
          evidenceIds: ["assumption"],
        },
      },
    };
    const agent = await service.create("p1", {
      fromId: base.id,
      patch,
      author: "agent",
      rationale: "Try stations",
    });
    const manual = await service.create("p1", {
      fromId: base.id,
      patch,
      author: "founder",
      rationale: "Try stations",
    });
    expect({ ...agent, id: manual.id, author: manual.author }).toEqual(manual);
    expect(agent.overrides.staffHeadcount).toEqual(
      base.overrides.staffHeadcount,
    );
    await expect(
      service.create("p1", {
        fromId: base.id,
        author: "agent",
        rationale: "Spoof",
        patch: {
          overrides: {
            ...patch.overrides,
            staffHeadcount: { ...base.overrides.staffHeadcount, value: 4 },
          },
        },
      }),
    ).rejects.toThrow(/founder/);
    await expect(
      service.create(
        "p1",
        { fromId: base.id, patch, author: "agent" },
        { idempotencyKey: "missing-reason" },
      ),
    ).rejects.toThrow(/rationale/);
  });

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
