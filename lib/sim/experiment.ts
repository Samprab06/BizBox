import { z } from "zod";
import type { DemandInput } from "@/lib/demand/contracts";
import { CATEGORY_DEFAULTS } from "@/lib/demand/defaults";
import { buildArrivalSchedule } from "@/lib/demand/model";
import { repriceBehaviorTable } from "@/lib/evaluation/evaluate";
import {
  ArrivalScheduleSchema,
  type ArrivalSchedule,
  DayTypeSchema,
  HoursSchema,
  SiteConfigSchema,
  type DayType,
  type SiteConfig,
} from "./contracts";
import { simulateDay } from "./engine";
import { computeMonthlyEconomics } from "./economics";
import { hourlySeries } from "./hourly";

const SettingsSchema = z
  .object({
    averageTicketUsd: z.number().finite().positive(),
    plannedStations: z.number().int().positive(),
    staffHeadcount: z.number().int().nonnegative(),
    hours: z.object({ weekday: HoursSchema, weekend: HoursSchema }),
    demandMultiplier: z.number().finite().positive(),
    seed: z.number().int().nonnegative(),
    dayType: DayTypeSchema,
  })
  .strict();

export type ExperimentSettings = z.infer<typeof SettingsSchema>;
export type ExperimentInput = {
  demand: DemandInput;
  config: SiteConfig;
  seed: number;
  dayType: DayType;
  smoothTimeBlocks?: boolean;
};

export function experimentSettings(input: ExperimentInput): ExperimentSettings {
  return SettingsSchema.parse({
    averageTicketUsd: input.config.prices.avgTicketUsd,
    plannedStations: input.config.stations.planned,
    staffHeadcount: input.config.staff.headcount,
    hours: input.config.hours,
    demandMultiplier: 1,
    seed: input.seed,
    dayType: input.dayType,
  });
}

/** Pure preview only. Persisted versions go through the shared scenario service. */
export function runExperiment(input: ExperimentInput, raw: ExperimentSettings) {
  const settings = SettingsSchema.parse(raw);
  const config = SiteConfigSchema.parse({
    ...input.config,
    hours: settings.hours,
    prices: { ...input.config.prices, avgTicketUsd: settings.averageTicketUsd },
    stations: { ...input.config.stations, planned: settings.plannedStations },
    staff: { ...input.config.staff, headcount: settings.staffHeadcount },
  });
  const priceChanged =
    settings.averageTicketUsd !== input.config.prices.avgTicketUsd;
  const demand: DemandInput = {
    ...input.demand,
    ...(input.config.service.meanServiceMin === undefined
      ? {}
      : {
          serviceMeanMin: {
            value: input.config.service.meanServiceMin,
            origin: input.demand.serviceMeanMin?.origin ?? "default",
          },
        }),
    ...(settings.demandMultiplier === 1
      ? {}
      : {
          scale: {
            value:
              (input.demand.scale?.value ??
                CATEGORY_DEFAULTS[input.demand.category].scale.value) *
              settings.demandMultiplier,
            origin: "founder",
          },
        }),
    demand:
      priceChanged && input.demand.demand.source === "jev"
        ? {
            source: "jev",
            behavior: repriceBehaviorTable(
              input.demand.demand.behavior,
              input.config.prices.avgTicketUsd,
              settings.averageTicketUsd,
            ),
          }
        : input.demand.demand,
  };
  const scheduleFor = (dayType: DayType) =>
    buildArrivalSchedule(demand, {
      seed: settings.seed,
      dayType,
      ...settings.hours[dayType],
      smoothTimeBlocks: input.smoothTimeBlocks,
    });
  const schedules = {
    weekday: scheduleFor("weekday"),
    weekend: scheduleFor("weekend"),
  };
  return runScheduledExperiment(config, settings, schedules);
}

/** Shared helper composition for explicitly prepared schedules, with no demand recalculation. */
export function runScheduledExperiment(
  rawConfig: SiteConfig,
  rawSettings: ExperimentSettings,
  rawSchedules: Record<DayType, ArrivalSchedule>,
) {
  const settings = SettingsSchema.parse(rawSettings);
  const config = SiteConfigSchema.parse({
    ...rawConfig,
    hours: settings.hours,
    prices: { ...rawConfig.prices, avgTicketUsd: settings.averageTicketUsd },
    stations: { ...rawConfig.stations, planned: settings.plannedStations },
    staff: { ...rawConfig.staff, headcount: settings.staffHeadcount },
  });
  const schedules = {
    weekday: ArrivalScheduleSchema.parse(rawSchedules.weekday),
    weekend: ArrivalScheduleSchema.parse(rawSchedules.weekend),
  };
  for (const day of ["weekday", "weekend"] as const) {
    const schedule = schedules[day];
    if (
      schedule.seed !== settings.seed ||
      schedule.dayType !== day ||
      schedule.siteId !== schedules.weekday.siteId ||
      schedule.openMin !== settings.hours[day].openMin ||
      schedule.closeMin !== settings.hours[day].closeMin
    )
      throw new RangeError(
        "Prepared schedules must match helper site, seed, day and opening hours",
      );
  }
  const days = {
    weekday: simulateDay(schedules.weekday, config),
    weekend: simulateDay(schedules.weekend, config),
  };
  const selected = days[settings.dayType];
  const hourly = hourlySeries(selected.events, selected.metrics);
  const waits = hourly.flatMap((hour) =>
    hour.p90WaitMin === null ? [] : [hour.p90WaitMin],
  );
  return {
    settings,
    config,
    schedules,
    days,
    selected,
    hourly,
    peakHourP90WaitMin: waits.length ? Math.max(...waits) : null,
    monthly: computeMonthlyEconomics(config, {
      weekday: days.weekday.metrics,
      weekend: days.weekend.metrics,
    }),
  };
}

export type ExperimentResult = ReturnType<typeof runExperiment>;

/** Alternative minus baseline, with absent wait observations retained as unknown. */
export function experimentDelta(
  baseline: ExperimentResult,
  alternative: ExperimentResult,
) {
  if (
    baseline.selected.siteId !== alternative.selected.siteId ||
    baseline.settings.dayType !== alternative.settings.dayType
  )
    throw new RangeError(
      "Compare experiment runs for the same site and day type",
    );
  const difference = (a: number | null, b: number | null) =>
    a === null || b === null ? null : b - a;
  return {
    monthlyContributionUsd:
      alternative.monthly.contributionUsd - baseline.monthly.contributionUsd,
    served:
      alternative.selected.metrics.served - baseline.selected.metrics.served,
    walkAways:
      alternative.selected.metrics.abandoned -
      baseline.selected.metrics.abandoned,
    p90WaitMin: difference(
      baseline.selected.metrics.p90WaitMin,
      alternative.selected.metrics.p90WaitMin,
    ),
    peakHourP90WaitMin: difference(
      baseline.peakHourP90WaitMin,
      alternative.peakHourP90WaitMin,
    ),
  };
}
