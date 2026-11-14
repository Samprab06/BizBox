import {
  SCENARIO_OVERRIDE_KEYS,
  SCENARIO_SCALAR_FIELDS,
  ScenarioSchema,
  type LayoutDiffSummary,
  type Scenario,
  type ScenarioDiff,
  type ScenarioOverrideKey,
  type ScenarioOverrides,
  type ScenarioScalarField,
} from "@/lib/contracts/scenario";

/**
 * HAC-80 (AGT-1): pure scenario model. There is deliberately no function here that
 * edits a scenario. `deriveScenario` returns a new, frozen version that points back
 * at its parent; the old one is untouched.
 */

type Overrides = ScenarioOverrides;
type Wrapper = Record<string, unknown>;

export class ScenarioError extends Error {
  constructor(
    readonly code: "invalid" | "diff_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "ScenarioError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Stable JSON with sorted keys, so structurally equal wrappers compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const clone = <T>(v: T): T => structuredClone(v);

/** Drops empty groups so one logical set of overrides has one representation. */
export function canonicalOverrides(overrides: Overrides): Overrides {
  const { hours, ...rest } = clone(overrides);
  const out: Overrides = { ...rest };
  const kept = Object.fromEntries(
    Object.entries(hours ?? {}).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(kept).length > 0) out.hours = kept;
  return JSON.parse(JSON.stringify(out)) as Overrides;
}

const normalizeSites = (siteIds: readonly string[]) => [...siteIds].sort();

/** Validates and freezes a scenario. Site IDs are sorted so the set has one form. */
export function parseScenario(input: unknown): Scenario {
  const raw = input as Partial<Scenario> | null;
  const candidate =
    raw && typeof raw === "object"
      ? {
          ...raw,
          siteIds: Array.isArray(raw.siteIds)
            ? normalizeSites(raw.siteIds)
            : raw.siteIds,
          overrides: raw.overrides
            ? canonicalOverrides(raw.overrides)
            : raw.overrides,
        }
      : input;
  const parsed = ScenarioSchema.safeParse(candidate);
  if (!parsed.success)
    throw new ScenarioError(
      "invalid",
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "scenario"}: ${i.message}`)
        .join("; "),
    );
  return deepFreeze(parsed.data);
}

export interface NewScenarioInput {
  id: string;
  projectId: string;
  siteIds: readonly string[];
  profileVersion: number;
  overrides?: Overrides;
  layoutId?: string | null;
  label: string;
  author: Scenario["author"];
  rationale?: string | null;
  createdAt: string;
}

/** The root of a project's scenario history (`parentId` is null). */
export function createRootScenario(input: NewScenarioInput): Scenario {
  return parseScenario({
    id: input.id,
    projectId: input.projectId,
    parentId: null,
    siteIds: input.siteIds,
    profileVersion: input.profileVersion,
    overrides: input.overrides ?? {},
    layoutId: input.layoutId ?? null,
    label: input.label,
    author: input.author,
    rationale: input.rationale ?? null,
    createdAt: input.createdAt,
  });
}

export interface ScenarioChanges {
  siteIds?: readonly string[];
  profileVersion?: number;
  /** Replaces the whole overrides object, not a partial merge. */
  overrides?: Overrides;
  layoutId?: string | null;
  label?: string;
}

export interface NewVersionMeta {
  id: string;
  createdAt: string;
  author: Scenario["author"];
  /** Required when author is "agent". Not carried over from the parent. */
  rationale?: string | null;
}

/**
 * A change to a scenario: a new version whose `parentId` is `parent.id`. Fields not
 * named in `changes` carry over. Author and rationale describe the new version.
 */
export function deriveScenario(
  parent: Scenario,
  changes: ScenarioChanges,
  meta: NewVersionMeta,
): Scenario {
  if (meta.id === parent.id)
    throw new ScenarioError("invalid", "A new version needs a new id");
  return parseScenario({
    id: meta.id,
    projectId: parent.projectId,
    parentId: parent.id,
    siteIds: changes.siteIds ?? parent.siteIds,
    profileVersion: changes.profileVersion ?? parent.profileVersion,
    overrides: changes.overrides ?? parent.overrides,
    layoutId: changes.layoutId === undefined ? parent.layoutId : changes.layoutId,
    label: changes.label ?? parent.label,
    author: meta.author,
    rationale: meta.rationale ?? null,
    createdAt: meta.createdAt,
  });
}

/* ---- diff ------------------------------------------------------------------ */

/** Leaf override wrappers by stable key. */
export function flattenOverrides(
  overrides: Overrides,
): Partial<Record<ScenarioOverrideKey, Wrapper>> {
  const out: Partial<Record<ScenarioOverrideKey, Wrapper>> = {};
  for (const day of ["weekday", "weekend"] as const) {
    const h = overrides.hours?.[day];
    if (h) {
      out[`hours.${day}.openMinute`] = h.openMinute;
      out[`hours.${day}.closeMinute`] = h.closeMinute;
    }
  }
  if (overrides.staffHeadcount) out.staffHeadcount = overrides.staffHeadcount;
  if (overrides.averageTicketCents)
    out.averageTicketCents = overrides.averageTicketCents;
  if (overrides.priceTier) out.priceTier = overrides.priceTier;
  if (overrides.plannedStations) out.plannedStations = overrides.plannedStations;
  if (overrides.demandMultiplier)
    out.demandMultiplier = overrides.demandMultiplier;
  if (overrides.seedSet) out.seedSet = overrides.seedSet;
  return out;
}

function unflattenOverrides(
  flat: Partial<Record<ScenarioOverrideKey, Wrapper>>,
): Overrides {
  const out: Record<string, unknown> = {};
  const hours: Record<string, Record<string, Wrapper>> = {};
  for (const key of SCENARIO_OVERRIDE_KEYS) {
    const value = flat[key];
    if (!value) continue;
    const m = /^hours\.(weekday|weekend)\.(openMinute|closeMinute)$/.exec(key);
    if (m) (hours[m[1]] ??= {})[m[2]] = clone(value);
    else out[key] = clone(value);
  }
  if (Object.keys(hours).length > 0) out.hours = hours;
  return out as Overrides;
}

const scalar = (s: Scenario, field: ScenarioScalarField) => s[field] ?? null;

export interface LayoutDiffHook {
  /** AGT-7 fills this in: a summary of what changed between two layouts. */
  summarize(from: string | null, to: string | null): LayoutDiffSummary | null;
  /** Must satisfy invert(summarize(a, b)) equals summarize(b, a). */
  invert(summary: LayoutDiffSummary): LayoutDiffSummary;
}

/** Until AGT-7 lands the layout diff reports only the two layout ids. */
export const stubLayoutDiff: LayoutDiffHook = {
  summarize: () => null,
  invert: (summary) => summary,
};

/**
 * Field-level changes from `a` to `b`: added and removed sites, every changed
 * scalar field, every changed override, and the layout change. Equal inputs give
 * an empty diff. `diffScenarios(b, a)` always equals `invertScenarioDiff` of
 * `diffScenarios(a, b)`.
 */
export function diffScenarios(
  a: Scenario,
  b: Scenario,
  layoutHook: LayoutDiffHook = stubLayoutDiff,
): ScenarioDiff {
  const aSites = new Set(a.siteIds);
  const bSites = new Set(b.siteIds);
  const flatA = flattenOverrides(a.overrides);
  const flatB = flattenOverrides(b.overrides);
  return {
    sites: {
      added: normalizeSites(b.siteIds.filter((s) => !aSites.has(s))),
      removed: normalizeSites(a.siteIds.filter((s) => !bSites.has(s))),
    },
    scalars: SCENARIO_SCALAR_FIELDS.filter(
      (f) => scalar(a, f) !== scalar(b, f),
    ).map((field) => ({
      field,
      from: scalar(a, field),
      to: scalar(b, field),
    })),
    overrides: SCENARIO_OVERRIDE_KEYS.filter(
      (k) => !same(flatA[k] ?? null, flatB[k] ?? null),
    ).map((key) => ({
      key,
      from: clone(flatA[key] ?? null),
      to: clone(flatB[key] ?? null),
    })),
    layout:
      a.layoutId === b.layoutId
        ? null
        : {
            from: a.layoutId,
            to: b.layoutId,
            summary: layoutHook.summarize(a.layoutId, b.layoutId),
          },
  };
}

export function isEmptyScenarioDiff(diff: ScenarioDiff): boolean {
  return (
    diff.sites.added.length === 0 &&
    diff.sites.removed.length === 0 &&
    diff.scalars.length === 0 &&
    diff.overrides.length === 0 &&
    diff.layout === null
  );
}

/** The diff that undoes `diff`: from and to swap, added and removed swap. */
export function invertScenarioDiff(
  diff: ScenarioDiff,
  layoutHook: LayoutDiffHook = stubLayoutDiff,
): ScenarioDiff {
  return {
    sites: { added: [...diff.sites.removed], removed: [...diff.sites.added] },
    scalars: diff.scalars.map((c) => ({ field: c.field, from: c.to, to: c.from })),
    overrides: diff.overrides.map((c) => ({
      key: c.key,
      from: clone(c.to),
      to: clone(c.from),
    })),
    layout: diff.layout && {
      from: diff.layout.to,
      to: diff.layout.from,
      summary: diff.layout.summary && layoutHook.invert(diff.layout.summary),
    },
  };
}

/**
 * Rebuilds `b` from `a` and `diffScenarios(a, b)`. Throws when `a` is not the
 * scenario the diff was computed from.
 */
export function applyScenarioDiff(a: Scenario, diff: ScenarioDiff): Scenario {
  const mismatch = (what: string) =>
    new ScenarioError("diff_mismatch", `Diff does not start from this scenario: ${what}`);
  const next: Record<string, unknown> = { ...a };

  const sites = new Set(a.siteIds);
  for (const s of diff.sites.removed) {
    if (!sites.delete(s)) throw mismatch(`site ${s} is not present`);
  }
  for (const s of diff.sites.added) {
    if (sites.has(s)) throw mismatch(`site ${s} is already present`);
    sites.add(s);
  }
  next.siteIds = normalizeSites([...sites]);

  for (const c of diff.scalars) {
    if (scalar(a, c.field) !== c.from) throw mismatch(c.field);
    next[c.field] = c.to;
  }

  const flat = flattenOverrides(a.overrides);
  for (const c of diff.overrides) {
    if (!same(flat[c.key] ?? null, c.from)) throw mismatch(c.key);
    if (c.to === null) delete flat[c.key];
    else flat[c.key] = c.to;
  }
  next.overrides = unflattenOverrides(flat);

  if (diff.layout) {
    if (a.layoutId !== diff.layout.from) throw mismatch("layoutId");
    next.layoutId = diff.layout.to;
  }
  return parseScenario(next);
}

/** Root-first chain of versions ending at `leafId`. Throws on a missing parent or a cycle. */
export function scenarioLineage(
  scenarios: readonly Scenario[],
  leafId: string,
): Scenario[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const chain: Scenario[] = [];
  const seen = new Set<string>();
  for (let id: string | null = leafId; id !== null; ) {
    const s = byId.get(id);
    if (!s || seen.has(id))
      throw new ScenarioError("invalid", `Broken scenario lineage at ${id}`);
    seen.add(id);
    chain.unshift(s);
    id = s.parentId;
  }
  return chain;
}
