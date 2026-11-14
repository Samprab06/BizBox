import { z } from "zod";
import { AssumedValueSchema, OriginSchema } from "./index";

/**
 * HAC-80 (AGT-1): immutable, versioned what-if scenarios.
 *
 * A scenario is never updated. Any change is a new row whose `parentId` points at
 * the version it replaces. Every override keeps the same provenance wrapper the
 * rest of the contracts use (value, unit, origin, evidenceIds). `founder` means the
 * founder asked for the value; an agent-authored scenario can never carry it.
 */

const Id = z.string().min(1);
export const MAX_SCENARIO_SITES = 8;

/** Known (non-null) numeric override built on the shared AssumedValue wrapper. */
const KnownNumber = (unit: string) =>
  AssumedValueSchema.refine(
    (v) => v.value !== null && Number.isFinite(v.value),
    "An override needs a known value",
  ).refine((v) => v.unit === unit, `Unit must be "${unit}"`);
const Positive = (unit: string) =>
  KnownNumber(unit).refine((v) => (v.value ?? 0) > 0, "Must be positive");
const WholeNumber = (unit: string, min: number, max = Infinity) =>
  KnownNumber(unit).refine(
    (v) =>
      Number.isInteger(v.value) && (v.value ?? 0) >= min && (v.value ?? 0) <= max,
    `Must be an integer from ${min} to ${max}`,
  );

/** Same fields as AssumedValue, for override values that are not a single number. */
const Wrapped = <T extends z.ZodType, U extends string>(value: T, unit: U) =>
  z
    .object({
      value,
      unit: z.literal(unit),
      origin: OriginSchema,
      evidenceIds: z.array(Id).min(1),
    })
    .strict();

export const PriceTierOverrideSchema = Wrapped(
  z.enum(["budget", "mid", "premium"]),
  "price_tier",
);
export const SeedSetOverrideSchema = Wrapped(
  z
    .array(z.number().int().nonnegative())
    .min(1)
    .max(100)
    .refine((s) => new Set(s).size === s.length, "Seeds must be unique"),
  "seeds",
);

const Hours = z
  .object({
    openMinute: WholeNumber("minute", 0, 1439),
    closeMinute: WholeNumber("minute", 1, 1440),
  })
  .strict()
  .refine(
    (h) => (h.closeMinute.value ?? 0) > (h.openMinute.value ?? 0),
    "Close must follow open",
  );

export const ScenarioOverridesSchema = z
  .object({
    hours: z
      .object({ weekday: Hours.optional(), weekend: Hours.optional() })
      .strict()
      .optional(),
    staffHeadcount: WholeNumber("people", 1).optional(),
    averageTicketCents: Positive("cents").optional(),
    priceTier: PriceTierOverrideSchema.optional(),
    plannedStations: WholeNumber("stations", 1).optional(),
    demandMultiplier: Positive("multiplier").optional(),
    seedSet: SeedSetOverrideSchema.optional(),
  })
  .strict();
export type ScenarioOverrides = z.infer<typeof ScenarioOverridesSchema>;

/** Every provenance origin found in an overrides object. */
export function overrideOrigins(overrides: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.origin === "string" && "evidenceIds" in o) out.push(o.origin);
    else Object.values(o).forEach(walk);
  };
  walk(overrides);
  return out;
}

export const ScenarioAuthorSchema = z.enum(["founder", "agent"]);
export type ScenarioAuthor = z.infer<typeof ScenarioAuthorSchema>;

export const ScenarioSchema = z
  .object({
    id: Id,
    projectId: Id,
    /** Previous version this one replaces; null for the root. */
    parentId: Id.nullable(),
    /** Sorted and unique; treated as a set. */
    siteIds: z
      .array(Id)
      .min(1)
      .max(MAX_SCENARIO_SITES)
      .refine((s) => new Set(s).size === s.length, "Site IDs must be unique")
      .refine(
        (s) => s.every((id, i) => i === 0 || s[i - 1] < id),
        "Site IDs must be sorted",
      ),
    profileVersion: z.number().int().positive(),
    overrides: ScenarioOverridesSchema,
    /** AGT-7 layout; null until a layout exists. */
    layoutId: Id.nullable(),
    label: z.string().min(1),
    author: ScenarioAuthorSchema,
    /** Required (non-blank) when author is "agent". */
    rationale: z.string().min(1).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.author === "agent" && !s.rationale?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "An agent-authored scenario needs a rationale",
      });
    if (s.author === "agent" && overrideOrigins(s.overrides).includes("founder"))
      ctx.addIssue({
        code: "custom",
        path: ["overrides"],
        message: "An agent-authored override can never carry origin founder",
      });
    if (s.parentId === s.id)
      ctx.addIssue({
        code: "custom",
        path: ["parentId"],
        message: "A scenario cannot be its own parent",
      });
  });
export type Scenario = z.infer<typeof ScenarioSchema>;

export const SCENARIO_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export const ScenarioRunStatusSchema = z.enum(SCENARIO_RUN_STATUSES);
export type ScenarioRunStatus = z.infer<typeof ScenarioRunStatusSchema>;

/** One evaluation of a scenario: the HAC-22 comparison and its site run IDs. */
export const ScenarioRunSchema = z
  .object({
    id: Id,
    projectId: Id,
    scenarioId: Id,
    comparisonId: Id.nullable(),
    runIds: z.array(Id),
    status: ScenarioRunStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ScenarioRun = z.infer<typeof ScenarioRunSchema>;

export const ActiveScenarioSchema = z
  .object({ projectId: Id, scenarioId: Id, updatedAt: z.iso.datetime() })
  .strict();
export type ActiveScenario = z.infer<typeof ActiveScenarioSchema>;

/* ---- diff shapes ---------------------------------------------------------- */

export const SCENARIO_SCALAR_FIELDS = [
  "id",
  "projectId",
  "parentId",
  "profileVersion",
  "label",
  "author",
  "rationale",
  "createdAt",
] as const;
export type ScenarioScalarField = (typeof SCENARIO_SCALAR_FIELDS)[number];

export const SCENARIO_OVERRIDE_KEYS = [
  "hours.weekday.openMinute",
  "hours.weekday.closeMinute",
  "hours.weekend.openMinute",
  "hours.weekend.closeMinute",
  "staffHeadcount",
  "averageTicketCents",
  "priceTier",
  "plannedStations",
  "demandMultiplier",
  "seedSet",
] as const;
export type ScenarioOverrideKey = (typeof SCENARIO_OVERRIDE_KEYS)[number];

/** Placeholder for AGT-7's layout diff summary; any JSON object. */
export type LayoutDiffSummary = Record<string, unknown>;

export type ScenarioDiff = {
  sites: { added: string[]; removed: string[] };
  scalars: {
    field: ScenarioScalarField;
    from: string | number | null;
    to: string | number | null;
  }[];
  /** A null side means the override is not set on that side. */
  overrides: {
    key: ScenarioOverrideKey;
    from: Record<string, unknown> | null;
    to: Record<string, unknown> | null;
  }[];
  layout: {
    from: string | null;
    to: string | null;
    summary: LayoutDiffSummary | null;
  } | null;
};
