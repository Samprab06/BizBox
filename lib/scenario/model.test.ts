import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "@/lib/sim/random";
import {
  SCENARIO_OVERRIDE_KEYS,
  SCENARIO_SCALAR_FIELDS,
  ScenarioSchema,
  type Scenario,
  type ScenarioOverrides,
} from "@/lib/contracts/scenario";
import {
  applyScenarioDiff,
  createRootScenario,
  deriveScenario,
  diffScenarios,
  invertScenarioDiff,
  isEmptyScenarioDiff,
  parseScenario,
  scenarioLineage,
  ScenarioError,
  type LayoutDiffHook,
} from "./model";

const wrap = <V, U extends string>(
  value: V,
  unit: U,
  origin: "costar" | "public" | "founder" | "default" = "default",
) => ({ value, unit, origin, evidenceIds: ["ev-1"] });

const root = (over: Partial<Parameters<typeof createRootScenario>[0]> = {}) =>
  createRootScenario({
    id: "s1",
    projectId: "p1",
    siteIds: ["site-b", "site-a"],
    profileVersion: 1,
    label: "Base",
    author: "founder",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

describe("scenario contract", () => {
  it("normalizes site order and freezes the result", () => {
    const s = root();
    expect(s.siteIds).toEqual(["site-a", "site-b"]);
    expect(s.parentId).toBeNull();
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.siteIds)).toBe(true);
    expect(() => {
      (s as { label: string }).label = "changed";
    }).toThrow(TypeError);
  });

  it("requires 1 to 8 unique sites", () => {
    expect(() => root({ siteIds: [] })).toThrow(ScenarioError);
    expect(() => root({ siteIds: ["a", "a"] })).toThrow(ScenarioError);
    const nine = Array.from({ length: 9 }, (_, i) => `site-${i}`);
    expect(() => root({ siteIds: nine })).toThrow(ScenarioError);
    expect(root({ siteIds: nine.slice(0, 8) }).siteIds).toHaveLength(8);
  });

  it("requires a rationale from the agent but not from the founder", () => {
    expect(() => root({ author: "agent" })).toThrow(/rationale/);
    expect(() => root({ author: "agent", rationale: "   " })).toThrow(/rationale/);
    expect(root({ author: "agent", rationale: "Tests a later close." }).rationale).toBe(
      "Tests a later close.",
    );
    expect(root({ author: "founder" }).rationale).toBeNull();
  });

  it("never lets an agent-authored override carry origin founder", () => {
    const founderOverride: ScenarioOverrides = {
      staffHeadcount: wrap(3, "people", "founder"),
    };
    const hoursFounder: ScenarioOverrides = {
      hours: {
        weekday: {
          openMinute: wrap(420, "minute", "default"),
          closeMinute: wrap(1200, "minute", "founder"),
        },
      },
    };
    for (const overrides of [founderOverride, hoursFounder]) {
      expect(() =>
        root({ author: "agent", rationale: "why", overrides }),
      ).toThrow(/never carry origin founder/);
      expect(root({ author: "founder", overrides }).overrides).toEqual(overrides);
    }
    expect(
      root({
        author: "agent",
        rationale: "why",
        overrides: { staffHeadcount: wrap(3, "people", "default") },
      }).author,
    ).toBe("agent");
  });

  it("rejects unknown fields, wrong units and malformed values", () => {
    const bad = (overrides: unknown) =>
      ScenarioSchema.safeParse({ ...root(), overrides }).success;
    expect(bad({ staffHeadcount: wrap(2.5, "people") })).toBe(false);
    expect(bad({ staffHeadcount: wrap(2, "dollars") })).toBe(false);
    expect(bad({ demandMultiplier: wrap(0, "multiplier") })).toBe(false);
    expect(bad({ demandMultiplier: wrap(1.2, "multiplier") })).toBe(true);
    expect(bad({ priceTier: wrap("luxury", "price_tier") })).toBe(false);
    expect(bad({ seedSet: wrap([1, 1], "seeds") })).toBe(false);
    expect(bad({ seedSet: wrap([1, 2], "seeds") })).toBe(true);
    expect(bad({ mystery: wrap(1, "x") })).toBe(false);
    expect(
      bad({
        hours: {
          weekend: {
            openMinute: wrap(600, "minute"),
            closeMinute: wrap(500, "minute"),
          },
        },
      }),
    ).toBe(false);
  });

  it("keeps the provenance wrapper on every override", () => {
    const noEvidence = { ...wrap(2, "people"), evidenceIds: [] };
    expect(ScenarioSchema.safeParse({ ...root(), overrides: { staffHeadcount: noEvidence } }).success).toBe(false);
    expect(ScenarioSchema.safeParse({ ...root(), overrides: { staffHeadcount: { value: 2, unit: "people" } } }).success).toBe(false);
  });
});

describe("versioning", () => {
  it("creates a new version pointing at its parent and leaves the parent untouched", () => {
    const parent = root({ overrides: { staffHeadcount: wrap(2, "people") } });
    const before = structuredClone(parent);
    const child = deriveScenario(
      parent,
      { overrides: { staffHeadcount: wrap(3, "people", "founder") }, label: "More staff" },
      { id: "s2", createdAt: "2026-01-02T00:00:00.000Z", author: "founder" },
    );
    expect(child.parentId).toBe("s1");
    expect(child.id).toBe("s2");
    expect(child.siteIds).toEqual(parent.siteIds);
    expect(child.overrides.staffHeadcount?.value).toBe(3);
    expect(parent).toEqual(before);
    expect(Object.isFrozen(child)).toBe(true);
  });

  it("does not carry the parent's rationale or author over", () => {
    const parent = root({ author: "agent", rationale: "first idea" });
    expect(() =>
      deriveScenario(parent, {}, { id: "s2", createdAt: "2026-01-02T00:00:00.000Z", author: "agent" }),
    ).toThrow(/rationale/);
    const child = deriveScenario(
      parent,
      { layoutId: "layout-1" },
      { id: "s2", createdAt: "2026-01-02T00:00:00.000Z", author: "founder" },
    );
    expect(child.author).toBe("founder");
    expect(child.rationale).toBeNull();
    expect(child.layoutId).toBe("layout-1");
  });

  it("refuses to reuse the parent's id", () => {
    expect(() =>
      deriveScenario(root(), {}, { id: "s1", createdAt: "2026-01-02T00:00:00.000Z", author: "founder" }),
    ).toThrow(ScenarioError);
  });

  it("exposes no in-place update in the model module", async () => {
    const model = await import("./model");
    const names = Object.keys(model).filter((n) => /^(update|set|patch|edit|mutate)/i.test(n));
    expect(names).toEqual([]);
  });

  it("walks the lineage root first and rejects broken chains", () => {
    const a = root();
    const meta = (id: string) => ({ id, createdAt: "2026-01-02T00:00:00.000Z", author: "founder" as const });
    const b = deriveScenario(a, { label: "B" }, meta("s2"));
    const c = deriveScenario(b, { label: "C" }, meta("s3"));
    expect(scenarioLineage([c, a, b], "s3").map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(() => scenarioLineage([c, a], "s3")).toThrow(/Broken/);
  });
});

/* ---- diff ------------------------------------------------------------------ */

const SITE_POOL = Array.from({ length: 12 }, (_, i) => `site-${String(i).padStart(2, "0")}`);
const ORIGINS = ["costar", "public", "founder", "default"] as const;
const AGENT_ORIGINS = ["costar", "public", "default"] as const;
const pick = <T,>(rng: Rng, items: readonly T[]) => items[rng.int(0, items.length - 1)];

function randomOverrides(rng: Rng, origins: readonly (typeof ORIGINS)[number][]): ScenarioOverrides {
  const o = () => pick(rng, origins);
  const out: ScenarioOverrides = {};
  const hours = () => {
    const open = rng.int(0, 700);
    return {
      openMinute: wrap(open, "minute", o()),
      closeMinute: wrap(rng.int(open + 1, 1440), "minute", o()),
    };
  };
  const hoursOut: NonNullable<ScenarioOverrides["hours"]> = {};
  if (rng.next() < 0.5) hoursOut.weekday = hours();
  if (rng.next() < 0.5) hoursOut.weekend = hours();
  if (hoursOut.weekday || hoursOut.weekend) out.hours = hoursOut;
  if (rng.next() < 0.5) out.staffHeadcount = wrap(rng.int(1, 6), "people", o());
  if (rng.next() < 0.5) out.averageTicketCents = wrap(rng.int(100, 5000), "cents", o());
  if (rng.next() < 0.5)
    out.priceTier = wrap(pick(rng, ["budget", "mid", "premium"] as const), "price_tier", o());
  if (rng.next() < 0.5) out.plannedStations = wrap(rng.int(1, 5), "stations", o());
  if (rng.next() < 0.5) out.demandMultiplier = wrap(0.5 + rng.int(0, 15) / 10, "multiplier", o());
  if (rng.next() < 0.5) {
    const seeds = new Set<number>();
    for (let i = rng.int(1, 4); i > 0; i--) seeds.add(rng.int(0, 99));
    out.seedSet = wrap([...seeds], "seeds", o());
  }
  return out;
}

function randomScenario(rng: Rng, n: number): Scenario {
  const sites = SITE_POOL.filter(() => rng.next() < 0.4).slice(0, 8);
  if (sites.length === 0) sites.push(pick(rng, SITE_POOL));
  const author = rng.next() < 0.5 ? "founder" : "agent";
  return createRootScenario({
    id: `gen-${n}`,
    projectId: "p1",
    siteIds: sites,
    profileVersion: rng.int(1, 3),
    overrides: randomOverrides(rng, author === "agent" ? AGENT_ORIGINS : ORIGINS),
    layoutId: rng.next() < 0.5 ? null : `layout-${rng.int(1, 3)}`,
    label: `Label ${rng.int(1, 4)}`,
    author,
    rationale: author === "agent" ? `Reason ${rng.int(1, 3)}` : rng.next() < 0.3 ? "note" : null,
    createdAt: new Date(Date.UTC(2026, 0, 1 + rng.int(0, 5))).toISOString(),
  });
}

describe("diffScenarios", () => {
  it("is empty for equal scenarios", () => {
    const a = root({ overrides: { staffHeadcount: wrap(2, "people") } });
    expect(isEmptyScenarioDiff(diffScenarios(a, structuredClone(a)))).toBe(true);
  });

  it("reports added and removed sites, changed overrides and the layout", () => {
    const a = root({
      siteIds: ["a", "b"],
      overrides: { staffHeadcount: wrap(2, "people"), demandMultiplier: wrap(1, "multiplier") },
    });
    const b = deriveScenario(
      a,
      {
        siteIds: ["b", "c", "d"],
        overrides: {
          staffHeadcount: wrap(4, "people", "founder"),
          priceTier: wrap("premium", "price_tier"),
        },
        layoutId: "layout-9",
        profileVersion: 2,
      },
      { id: "s2", createdAt: "2026-01-02T00:00:00.000Z", author: "founder" },
    );
    const d = diffScenarios(a, b);
    expect(d.sites).toEqual({ added: ["c", "d"], removed: ["a"] });
    expect(d.overrides.map((c) => c.key)).toEqual([
      "staffHeadcount",
      "priceTier",
      "demandMultiplier",
    ]);
    expect(d.overrides[0]).toMatchObject({ from: { value: 2 }, to: { value: 4, origin: "founder" } });
    expect(d.overrides[2]).toMatchObject({ from: { value: 1 }, to: null });
    expect(d.layout).toEqual({ from: null, to: "layout-9", summary: null });
    expect(d.scalars.map((c) => c.field)).toEqual(["id", "parentId", "profileVersion", "createdAt"]);
  });

  it("notices an origin change on an otherwise equal value", () => {
    const a = root({ overrides: { staffHeadcount: wrap(2, "people", "default") } });
    const b = deriveScenario(
      a,
      { overrides: { staffHeadcount: wrap(2, "people", "founder") } },
      { id: "s2", createdAt: "2026-01-01T00:00:00.000Z", author: "founder" },
    );
    expect(diffScenarios(a, b).overrides).toHaveLength(1);
  });

  it("covers every field of the scenario", () => {
    const base = root({
      overrides: {
        hours: {
          weekday: { openMinute: wrap(400, "minute"), closeMinute: wrap(1000, "minute") },
          weekend: { openMinute: wrap(500, "minute"), closeMinute: wrap(900, "minute") },
        },
        staffHeadcount: wrap(2, "people"),
        averageTicketCents: wrap(500, "cents"),
        priceTier: wrap("mid", "price_tier"),
        plannedStations: wrap(2, "stations"),
        demandMultiplier: wrap(1, "multiplier"),
        seedSet: wrap([1, 2], "seeds"),
      },
    });
    const scenarioKeys = Object.keys(base).sort();
    const covered = [
      ...SCENARIO_SCALAR_FIELDS,
      "siteIds",
      "overrides",
      "layoutId",
    ].sort();
    expect(scenarioKeys).toEqual(covered);

    // Change one field at a time: each must show up in the diff.
    const changed = (changes: Partial<Parameters<typeof deriveScenario>[1]>) =>
      diffScenarios(
        base,
        deriveScenario(base, changes, {
          id: "s2",
          createdAt: base.createdAt,
          author: "founder",
          rationale: null,
        }),
      );
    expect(changed({ siteIds: ["zzz"] }).sites.added).toEqual(["zzz"]);
    expect(changed({ profileVersion: 5 }).scalars.map((c) => c.field)).toContain("profileVersion");
    expect(changed({ label: "x" }).scalars.map((c) => c.field)).toContain("label");
    expect(changed({ layoutId: "L" }).layout).not.toBeNull();
    for (const key of SCENARIO_OVERRIDE_KEYS) {
      const without = structuredClone(base.overrides) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (key.startsWith("hours.")) {
        const [, day, field] = key.split(".");
        const h = without.hours[day];
        h[field] = { ...h[field], value: field === "openMinute" ? h[field].value - 1 : h[field].value + 1 };
      } else if (key === "seedSet") without.seedSet.value = [9];
      else if (key === "priceTier") without.priceTier.value = "budget";
      else without[key] = { ...without[key], value: without[key].value + 1 };
      expect(changed({ overrides: without }).overrides.map((c) => c.key)).toEqual([key]);
    }
    expect(changed({ overrides: {} }).overrides.map((c) => c.key)).toEqual([...SCENARIO_OVERRIDE_KEYS]);
  });

  it("calls the AGT-7 layout hook and inverts its summary", () => {
    const hook: LayoutDiffHook = {
      summarize: (from, to) => ({ moved: `${from}->${to}` }),
      invert: (s) => {
        const [a, b] = String(s.moved).split("->");
        return { moved: `${b}->${a}` };
      },
    };
    const a = root({ layoutId: "l1" });
    const b = deriveScenario(a, { layoutId: "l2" }, { id: "s2", createdAt: a.createdAt, author: "founder" });
    const fwd = diffScenarios(a, b, hook);
    expect(fwd.layout?.summary).toEqual({ moved: "l1->l2" });
    expect(invertScenarioDiff(fwd, hook)).toEqual(diffScenarios(b, a, hook));
  });

  it("has a reverse diff that exactly inverts the forward diff (generated cases)", () => {
    const rng = createRng("hac-80-diff-symmetry");
    const hook: LayoutDiffHook = {
      summarize: (from, to) => (from === to ? null : { pair: [from, to] }),
      invert: (s) => ({ pair: [...(s.pair as unknown[])].reverse() }),
    };
    for (let i = 0; i < 150; i++) {
      const a = randomScenario(rng, 2 * i);
      const b = randomScenario(rng, 2 * i + 1);
      for (const h of [undefined, hook]) {
        const forward = diffScenarios(a, b, h);
        const reverse = diffScenarios(b, a, h);
        expect(invertScenarioDiff(forward, h)).toEqual(reverse);
        expect(invertScenarioDiff(reverse, h)).toEqual(forward);
        // Applying the forward diff rebuilds b; applying the reverse rebuilds a.
        expect(applyScenarioDiff(a, forward)).toEqual(b);
        expect(applyScenarioDiff(b, reverse)).toEqual(a);
      }
      expect(isEmptyScenarioDiff(diffScenarios(a, a))).toBe(true);
    }
  }, 30_000);

  it("refuses to apply a diff to the wrong scenario", () => {
    const a = root();
    const b = deriveScenario(a, { label: "B" }, { id: "s2", createdAt: a.createdAt, author: "founder" });
    const other = root({ id: "other", label: "Other" });
    expect(() => applyScenarioDiff(other, diffScenarios(a, b))).toThrow(ScenarioError);
  });

  it("round-trips parsed JSON", () => {
    const rng = createRng(7);
    const s = randomScenario(rng, 1);
    expect(parseScenario(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
