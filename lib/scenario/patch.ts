import { z } from "zod";
import {
  ScenarioOverridesSchema,
  type Scenario,
} from "@/lib/contracts/scenario";
import type { ScenarioChanges } from "./model";

const id = z.string().trim().min(1).max(200);
const sites = z
  .array(id)
  .min(1)
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length, "Site IDs must be unique");
const integer = z.number().int().positive();
export const ScenarioChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fork"),
      label: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hours"),
      dayType: z.enum(["weekday", "weekend"]),
      openMinute: z.number().int().min(0).max(1439),
      closeMinute: z.number().int().min(1).max(1440),
    })
    .strict()
    .refine((v) => v.closeMinute > v.openMinute, "Close must follow open"),
  z
    .object({ kind: z.literal("staffing"), headcount: integer.max(1000) })
    .strict(),
  z
    .object({
      kind: z.literal("price"),
      averageTicketCents: integer.max(1000000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("price_tier"),
      tier: z.enum(["budget", "mid", "premium"]),
    })
    .strict(),
  z.object({ kind: z.literal("stations"), count: integer.max(100) }).strict(),
  z.object({ kind: z.literal("add_sites"), siteIds: sites }).strict(),
  z.object({ kind: z.literal("remove_sites"), siteIds: sites }).strict(),
]);
export type ScenarioChange = z.infer<typeof ScenarioChangeSchema>;
const sourceSchema = z
  .object({
    origin: z.enum(["founder", "default"]),
    evidenceIds: z.array(id).min(1).max(100),
  })
  .strict();
export type ScenarioChangeSource = z.infer<typeof sourceSchema>;

export class ScenarioPatchError extends Error {}

/**
 * Shared pure patch builder for levers and tools. Scenario service replaces the
 * overrides object, so merge here and preserve every untouched provenance wrapper.
 * Capacity/layout and parent-author validation still belong to the caller/service.
 */
export function buildScenarioPatch(
  parent: Scenario,
  raw: unknown,
  source: ScenarioChangeSource,
): ScenarioChanges {
  const change = ScenarioChangeSchema.parse(raw);
  const provenance = sourceSchema.parse(source);
  const wrapped = (value: number, unit: string) => ({
    value,
    unit,
    ...provenance,
  });
  const overrides = structuredClone(parent.overrides);
  switch (change.kind) {
    case "fork":
      return { label: change.label };
    case "hours":
      overrides.hours = {
        ...overrides.hours,
        [change.dayType]: {
          openMinute: wrapped(change.openMinute, "minute"),
          closeMinute: wrapped(change.closeMinute, "minute"),
        },
      };
      break;
    case "staffing":
      overrides.staffHeadcount = wrapped(change.headcount, "people");
      break;
    case "price":
      overrides.averageTicketCents = wrapped(
        change.averageTicketCents,
        "cents",
      );
      break;
    case "price_tier":
      overrides.priceTier = {
        value: change.tier,
        unit: "price_tier",
        ...provenance,
      };
      break;
    case "stations":
      overrides.plannedStations = wrapped(change.count, "stations");
      break;
    case "add_sites": {
      if (change.siteIds.some((id) => parent.siteIds.includes(id)))
        throw new ScenarioPatchError("A selected site cannot be added again");
      return {
        siteIds: sites.parse([...parent.siteIds, ...change.siteIds]).sort(),
      };
    }
    case "remove_sites": {
      if (change.siteIds.some((id) => !parent.siteIds.includes(id)))
        throw new ScenarioPatchError("Only selected sites can be removed");
      return {
        siteIds: sites
          .parse(parent.siteIds.filter((id) => !change.siteIds.includes(id)))
          .sort(),
      };
    }
  }
  return { overrides: ScenarioOverridesSchema.parse(overrides) };
}
