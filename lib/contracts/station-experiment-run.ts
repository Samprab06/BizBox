import { z } from "zod";
import { HoursSchema } from "@/lib/sim/contracts";
import { StationExperimentResultSchema } from "./station-experiment";
const id = z.string().trim().min(1).max(200);
export const StationExperimentConfigurationIdSchema = z.enum([
  "baseline",
  "plus-one",
  "plus-two",
]);
export type StationExperimentConfigurationId = z.infer<
  typeof StationExperimentConfigurationIdSchema
>;
export const StationExperimentPlanRequestSchema = z
  .object({
    comparisonId: id,
    siteId: id,
    dayType: z.enum(["weekday", "weekend"]).default("weekday"),
  })
  .strict();
export const StationExperimentPostSchema =
  StationExperimentPlanRequestSchema.extend({
    configurationId: StationExperimentConfigurationIdSchema,
    confirm: z.boolean().default(false),
  });
const count = z.number().int().nonnegative();
export const StationExperimentRunSchema = z.object({
  status: z.enum([
    "planned",
    "running",
    "needs_confirmation",
    "ready",
    "unavailable",
  ]),
  source: z.object({
    comparisonId: id,
    projectId: id,
    siteId: id,
    dayType: z.enum(["weekday", "weekend"]),
    profileId: id,
    profileVersion: count.positive(),
    seedCount: count,
    seeds: z.array(count),
    synthetic: z.boolean(),
    demandSource: z.enum(["huff", "jev"]),
    sourceNotice: z.string().nullable(),
    currentProfileVersion: count.positive().nullable(),
    outdated: z.boolean().nullable(),
  }),
  configurations: z
    .array(
      z.object({
        id: StationExperimentConfigurationIdSchema,
        plannedStations: count,
        effectiveStations: count,
        staffHeadcount: count,
        hours: z.object({ weekday: HoursSchema, weekend: HoursSchema }),
        costUnits: count,
        status: z.enum(["planned", "queued", "running", "succeeded", "failed"]),
        scenarioId: id,
        runId: id,
        comparisonId: id.nullable(),
        cached: z.boolean(),
      }),
    )
    .max(3),
  nextConfigurationId: StationExperimentConfigurationIdSchema.nullable(),
  confirmation: z
    .object({
      configurationId: StationExperimentConfigurationIdSchema,
      costUnits: count,
      remainingUnits: count,
    })
    .nullable(),
  result: StationExperimentResultSchema.nullable(),
  unavailable: z.object({ code: z.string(), reason: z.string() }).nullable(),
});
export type StationExperimentRun = z.infer<typeof StationExperimentRunSchema>;
