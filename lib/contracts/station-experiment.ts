import { z } from "zod";
import {
  SiteConfigSchema,
  OriginSchema,
  HoursSchema,
  DayTypeSchema,
} from "@/lib/sim/contracts";

export const STATION_OBSERVATION_VERSION = "hac102-v1" as const;
const finite = z.number().finite();
const count = finite.int().nonnegative();
const summary = z.object({
  mean: finite,
  low: finite,
  median: finite,
  high: finite,
});
export const StationExperimentCalloutSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("station-experiment"),
  siteId: z.string().min(1),
  dayType: DayTypeSchema,
  label: z.literal("Modeled additional monthly revenue"),
  caption: z.literal("Modeled, not a forecast"),
  change: z.object({
    scope: z.literal("whole-operating-day"),
    fromPlannedStations: count,
    toPlannedStations: count,
    fromEffectiveStations: count,
    toEffectiveStations: count,
    fromStaffHeadcount: count,
    toStaffHeadcount: count,
    hours: z.object({ weekday: HoursSchema, weekend: HoursSchema }),
  }),
  monthlyRevenueChangeUsd: summary,
  monthlyContributionChangeUsd: summary,
  monthlyWalkAwayChange: summary,
  selectedDayWalkAwayChange: summary,
  addedStationHoursPerMonth: finite,
  addedStaffHoursPerMonth: finite,
  source: z.object({
    mode: z.literal("aggregate"),
    seedCount: count.min(2).max(100),
    seeds: z.array(count).min(2).max(100),
    outputKind: z.literal("simulation"),
  }),
  origins: z.array(OriginSchema).min(1),
  limitations: z.array(z.string()),
});
export type StationExperimentCallout = z.infer<
  typeof StationExperimentCalloutSchema
>;
const metrics = z
  .object({
    openMin: finite.min(0).max(1440),
    closeMin: finite.min(0).max(1440),
    stations: count.positive(),
    served: count,
    balked: count,
    reneged: count,
    abandoned: count,
    revenueUsd: finite.nonnegative(),
  })
  .strict();
export const StationObservationsSchema = z
  .object({
    version: z.literal(STATION_OBSERVATION_VERSION),
    siteId: z.string().min(1),
    config: SiteConfigSchema,
    settings: z
      .object({
        averageTicketUsd: finite.positive(),
        plannedStations: count.positive(),
        staffHeadcount: count,
        hours: z.object({ weekday: HoursSchema, weekend: HoursSchema }),
        demandMultiplier: finite.positive(),
      })
      .strict(),
    points: z
      .array(
        z
          .object({
            seed: count,
            days: z.object({ weekday: metrics, weekend: metrics }).strict(),
            monthly: z
              .object({
                revenueUsd: finite.nonnegative(),
                contributionUsd: finite,
                staffHours: finite.nonnegative(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.points.map((p) => p.seed)).size === v.points.length,
    "Seeds must be unique",
  );
export type StationObservations = z.infer<typeof StationObservationsSchema>;
export const StationExperimentIdentitySchema = z.object({
  projectId: z.string().min(1),
  siteId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: count.positive(),
  modelVersion: z.string().min(1),
  baselineComparisonId: z.string().min(1),
  alternativeComparisonIds: z.array(z.string().min(1)).max(8),
  seeds: z.array(count).min(2).max(100),
  synthetic: z.boolean(),
});
export const StationExperimentResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    selected: StationExperimentCalloutSchema.nullable(),
    variants: z.array(StationExperimentCalloutSchema).max(8),
    identity: StationExperimentIdentitySchema,
  }),
  z.object({
    status: z.literal("unavailable"),
    code: z.enum([
      "missing_observations",
      "incompatible",
      "insufficient_seeds",
    ]),
    reason: z.string(),
  }),
]);
export type StationExperimentResult = z.infer<
  typeof StationExperimentResultSchema
>;
