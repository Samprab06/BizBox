import { z } from "zod";
import { OriginSchema } from "./index";

const nonnegative = z.number().finite().nonnegative();
export const InsightEstimateSchema = z.object({
  mean: nonnegative,
  p5: nonnegative,
  p95: nonnegative,
});
const waitEstimate = z.object({
  mean: nonnegative.nullable(),
  p5: nonnegative.nullable(),
  p95: nonnegative.nullable(),
});
export type InsightEstimate = z.infer<typeof InsightEstimateSchema>;
export const InsightPointSchema = z.object({
  lng: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-85).max(85),
});
export const InsightOriginFrameSchema = z.object({
  center: InsightPointSchema,
  cellSideMeters: z.number().finite().min(1).max(10_000),
});
export const ServedOriginMapSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable"), reason: z.string().min(1) }),
  z.object({
    status: z.literal("available"),
    basis: z.enum(["explicit_sampled_origins", "authored_synthetic_origins"]),
    sourceLabel: z.string().min(1),
    frame: InsightOriginFrameSchema,
    cells: z
      .array(
        z.object({
          key: z.string(),
          center: InsightPointSchema,
          polygon: z.array(InsightPointSchema).length(7),
          served: InsightEstimateSchema,
        }),
      )
      .max(256),
    unmappedServed: InsightEstimateSchema,
  }),
]);
export const InsightsHourSchema = z.object({
  hour: z.number().int().min(0).max(23),
  openMinutes: nonnegative.max(60),
  closed: z.boolean(),
  arrivals: InsightEstimateSchema,
  joined: InsightEstimateSchema,
  served: InsightEstimateSchema,
  balked: InsightEstimateSchema,
  reneged: InsightEstimateSchema,
  /** Sum within each seed before aggregation; marginal quantiles must not be added. */
  walkaways: InsightEstimateSchema,
  meanWaitMin: waitEstimate,
  p90WaitMin: waitEstimate,
  meanQueueLength: InsightEstimateSchema,
  maxQueueLength: InsightEstimateSchema,
  stationUtilization: InsightEstimateSchema,
  revenueUsd: InsightEstimateSchema,
  cumulativeRevenueUsd: InsightEstimateSchema,
  capacityCustomers: nonnegative.nullable(),
  waitObservedSeeds: z.number().int().min(0).max(100),
});
export const InsightsDaySchema = z.object({
  dayType: z.enum(["weekday", "weekend"]),
  mode: z.literal("aggregate"),
  seedCount: z.number().int().min(1).max(100),
  waitBasis: z.literal("completed_customers_by_service_start_hour"),
  hours: z.array(InsightsHourSchema).length(24),
  capacityInputs: z.object({
    stations: z.number().int().positive(),
    meanServiceMin: z.number().finite().positive().nullable(),
    stationOrigin: OriginSchema.nullable(),
    serviceMeanOrigin: OriginSchema.nullable(),
  }),
  mix: z.object({
    basis: z.literal("modeled_arrivals"),
    distanceBasis: z.literal("straight_line_modeled_persona_to_site"),
    kindCounts: z.object({
      resident: InsightEstimateSchema,
      worker: InsightEstimateSchema,
      passby: InsightEstimateSchema,
    }),
    unknownKind: InsightEstimateSchema,
    distanceCounts: z.object({
      underHalf: InsightEstimateSchema,
      halfToOne: InsightEstimateSchema,
      oneToThree: InsightEstimateSchema,
      overThree: InsightEstimateSchema,
      unknown: InsightEstimateSchema,
    }),
  }),
  servedOriginMap: ServedOriginMapSchema,
});
export type InsightsDay = z.infer<typeof InsightsDaySchema>;
export type InsightsHour = z.infer<typeof InsightsHourSchema>;
export const SiteInsightsSchema = z
  .object({
    version: z.literal("hac94-v1"),
    siteId: z.string().min(1),
    synthetic: z.boolean(),
    seedCount: z.number().int().min(1).max(100),
    days: z.object({ weekday: InsightsDaySchema, weekend: InsightsDaySchema }),
  })
  .superRefine((value, ctx) => {
    for (const day of ["weekday", "weekend"] as const) {
      const data = value.days[day];
      if (data.dayType !== day || data.seedCount !== value.seedCount)
        ctx.addIssue({
          code: "custom",
          path: ["days", day],
          message: "Day type and seed count must match the site summary",
        });
      data.hours.forEach((row, hour) => {
        if (row.waitObservedSeeds > data.seedCount)
          ctx.addIssue({
            code: "custom",
            path: ["days", day, "hours", hour, "waitObservedSeeds"],
            message: "Observed wait seeds cannot exceed the day seed count",
          });
        if (row.hour !== hour)
          ctx.addIssue({
            code: "custom",
            path: ["days", day, "hours", hour],
            message: "Hours must be ordered 0 through 23",
          });
      });
    }
  });
export type SiteInsights = z.infer<typeof SiteInsightsSchema>;
