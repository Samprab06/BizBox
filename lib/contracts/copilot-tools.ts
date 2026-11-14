import { z } from "zod";
import { LayoutOpSchema } from "./layout";

const id = z.string().trim().min(1).max(200);
const rationale = z.string().trim().min(1).max(8000);
const scenario = { scenario_id: id, rationale };
const siteIds = z
  .array(id)
  .min(1)
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length, "Site IDs must be unique");
const minute = z.number().int().min(0).max(1440);

/** Tool argument names are independent of model prose; project identity is trusted context. */
export const CopilotMutationSchemas = {
  fork_scenario: z
    .object({
      from_id: id,
      label: z.string().trim().min(1).max(200),
      rationale,
    })
    .strict(),
  set_hours: z
    .object({
      ...scenario,
      day_type: z.enum(["weekday", "weekend"]),
      open: minute.max(1439),
      close: minute.min(1),
    })
    .strict()
    .refine((v) => v.close > v.open, "Close must follow open"),
  set_staffing: z
    .object({
      ...scenario,
      headcount: z.number().int().positive().max(1000).optional(),
      by_hour: z
        .array(
          z
            .object({
              open: minute.max(1439),
              close: minute.min(1),
              headcount: z.number().int().positive().max(1000),
            })
            .strict(),
        )
        .min(1)
        .max(24)
        .optional(),
    })
    .strict()
    .refine(
      (v) => v.headcount !== undefined || v.by_hour !== undefined,
      "Provide a headcount",
    ),
  set_price: z
    .object({
      ...scenario,
      avg_ticket: z.number().finite().positive().max(10000).optional(),
      tier: z.enum(["budget", "mid", "premium"]).optional(),
    })
    .strict()
    .refine(
      (v) => (v.avg_ticket === undefined) !== (v.tier === undefined),
      "Provide exactly one average ticket or tier",
    ),
  set_stations: z
    .object({ ...scenario, n: z.number().int().positive().max(100) })
    .strict(),
  add_sites: z.object({ ...scenario, site_ids: siteIds }).strict(),
  remove_sites: z.object({ ...scenario, site_ids: siteIds }).strict(),
  edit_layout: z
    .object({ ...scenario, ops: z.array(LayoutOpSchema).min(1).max(100) })
    .strict(),
  run_scenario: z.object({ scenario_id: id }).strict(),
};
export type CopilotMutationToolName = keyof typeof CopilotMutationSchemas;

export const ScenarioValueReferenceSchema = z
  .object({
    kind: z.literal("scenario_value"),
    scenarioId: id,
    path: z.string().min(1).max(200),
  })
  .strict();

export const PriceAcceptanceShiftReferenceSchema = z
  .object({
    kind: z.literal("price_acceptance_shift"),
    comparisonId: id,
    scenarioId: id,
    siteId: id,
  })
  .strict();

export const CopilotMutationResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("created"),
      scenarioId: id,
      parentId: id,
      priceAcceptance: z
        .object({
          status: z.enum(["cached_curve", "unavailable", "tier_requires_run"]),
          references: z.array(PriceAcceptanceShiftReferenceSchema),
        })
        .strict()
        .optional(),
      diff: z
        .object({
          sites: z
            .object({ added: z.array(id), removed: z.array(id) })
            .strict(),
          changedPaths: z.array(z.string()),
          values: z.array(
            z
              .object({
                before: ScenarioValueReferenceSchema.nullable(),
                after: ScenarioValueReferenceSchema.nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal("unsupported"),
      code: z.literal("ADAPTER_UNAVAILABLE"),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      code: z.enum([
        "INVALID_INPUT",
        "PROVENANCE_CONFLICT",
        "NOT_FOUND",
        "CAPACITY_CONFLICT",
        "UNAVAILABLE",
        "STALE_CONTEXT",
      ]),
      message: z.string(),
    })
    .strict(),
]);
export type CopilotMutationResult = z.infer<typeof CopilotMutationResultSchema>;
