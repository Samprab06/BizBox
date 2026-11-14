/**
 * A recorded Jev panel for the Montrose example (HAC-101): every persona answered once against
 * the example sites and competitors, saved as behavior tables so the example renders from Jev
 * answers with no network call. Written by `scripts/record-jev-example.ts`; read by
 * `recorded-example-loader.ts`. This file is pure (no fs) so the helpers work anywhere.
 */
import { z } from "zod";
import { buildArrivalSchedule } from "@/lib/demand/model";
import {
  Storefront,
  type ArrivalSchedule,
  type Category,
  type City,
  type PriceTier,
  type ScheduleRequest,
} from "@/lib/demand/contracts";
import {
  BehaviorTableSchema,
  CompetitorSchema,
  NeedSpecSchema,
  PersonaSetSchema,
  type BehaviorTable,
  type BusinessType,
} from "./contracts";

export const RECORDED_EXAMPLE_FILE =
  "lib/panel/__fixtures__/jev-montrose-example.json";

export const RecordedJevExampleSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO date or date-time the panel was recorded. */
  recordedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, "recordedAt must start with YYYY-MM-DD"),
  /** The version Jev answered with (for example jev-1.14.0), not the requested alias. */
  modelVersion: z.string().min(1),
  need: NeedSpecSchema,
  personaSet: PersonaSetSchema,
  competitors: z.array(CompetitorSchema),
  sites: z
    .array(
      z.object({
        /** The example site id (for example "montrose"); equals `table.siteId`. */
        siteId: z.string().min(1),
        storefront: Storefront,
        table: BehaviorTableSchema,
      }),
    )
    .min(1),
  panel: z.object({
    orders: z.number().int().positive(),
    calls: z.number().int().nonnegative(),
    retriedCalls: z.number().int().nonnegative(),
    failedCalls: z.number().int().nonnegative(),
  }),
});
export type RecordedJevExample = z.infer<typeof RecordedJevExampleSchema>;

/** "Recorded Jev answers, jev-1.14.0, 2026-11-14". */
export function recordedExampleLabel(
  recorded: Pick<RecordedJevExample, "modelVersion" | "recordedAt">,
): string {
  return `Recorded Jev answers, ${recorded.modelVersion}, ${recorded.recordedAt.slice(0, 10)}`;
}

/** A recording is usable only if every persona answered at every site. */
export function recordedExampleIssues(recorded: RecordedJevExample): string[] {
  const issues: string[] = [];
  for (const { siteId, table } of recorded.sites) {
    if (table.siteId !== siteId)
      issues.push(`table for ${siteId} is labelled ${table.siteId}`);
    if (table.failedPersonaIds.length)
      issues.push(
        `${siteId}: ${table.failedPersonaIds.length} personas failed`,
      );
    if (table.personas.length !== recorded.personaSet.personas.length)
      issues.push(
        `${siteId}: ${table.personas.length} of ${recorded.personaSet.personas.length} personas answered`,
      );
  }
  return issues;
}

const CATEGORY: Record<BusinessType, Category> = {
  coffee: "coffee",
  quick_food: "quick_food",
  salon_barber: "salon",
  fitness_studio: "fitness",
};

export interface RecordedScheduleOptions extends ScheduleRequest {
  city?: City;
  priceTier?: PriceTier;
  /** Market-share multiplier on top of the category default (1). */
  scale?: number;
}

/** The recorded behavior table for one example site. */
export function recordedTable(
  recorded: RecordedJevExample,
  siteId: string,
): BehaviorTable {
  const site = recorded.sites.find((s) => s.siteId === siteId);
  if (!site) throw new Error(`No recorded Jev table for site "${siteId}"`);
  return site.table;
}

/**
 * Turns a recorded table into a seeded arrival schedule through the demand model, so the
 * simulator and the example comparison can run on Jev answers without calling Jev.
 */
export function recordedExampleSchedule(
  recorded: RecordedJevExample,
  siteId: string,
  options: RecordedScheduleOptions,
): ArrivalSchedule {
  const site = recorded.sites.find((s) => s.siteId === siteId);
  if (!site) throw new Error(`No recorded Jev table for site "${siteId}"`);
  const { city = "houston", priceTier = "mid", scale, ...request } = options;
  return buildArrivalSchedule(
    {
      site: site.storefront,
      personaSet: recorded.personaSet,
      city,
      category: CATEGORY[recorded.need.businessType],
      priceTier,
      demand: { source: "jev", behavior: site.table },
      ...(scale === undefined
        ? {}
        : { scale: { value: scale, origin: "default" as const } }),
    },
    request,
  );
}

/** Persona rows in the shape the replay screen shows (label, visits a month, where they go). */
export function recordedExamplePersonas(
  recorded: RecordedJevExample,
  siteId = recorded.sites[0]!.siteId,
) {
  const table = recordedTable(recorded, siteId);
  const siteIds = new Set(recorded.sites.map((s) => s.siteId));
  return recorded.personaSet.personas.map((persona) => {
    const behavior = table.personas.find((p) => p.personaId === persona.id);
    return {
      id: persona.id,
      label: persona.description || persona.segment,
      monthlyVisits: behavior?.visitsPerMonth,
      destinations: Object.entries(behavior?.where ?? {}).map(
        ([destinationId, share]) => ({
          label:
            destinationId === "none"
              ? "No visit"
              : siteIds.has(destinationId)
                ? "Example site"
                : "Example competitor",
          share,
        }),
      ),
    };
  });
}
