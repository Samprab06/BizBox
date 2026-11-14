import {
  StationObservationsSchema,
  STATION_OBSERVATION_VERSION,
  type StationObservations,
} from "@/lib/contracts/station-experiment";
import type { ExperimentResult } from "@/lib/sim/experiment";

/** Retain actual helper outputs, never fabricated schedules or reconstructed observations. */
export function captureStationObservations(
  results: readonly ExperimentResult[],
): StationObservations {
  const first = results[0];
  if (!first) throw new RangeError("Completed helper observations required");
  const {
    averageTicketUsd,
    plannedStations,
    staffHeadcount,
    hours,
    demandMultiplier,
  } = first.settings;
  const metrics = (day: ExperimentResult["days"]["weekday"]) => {
    const {
      openMin,
      closeMin,
      stations,
      served,
      balked,
      reneged,
      abandoned,
      revenueUsd,
    } = day.metrics;
    return {
      openMin,
      closeMin,
      stations,
      served,
      balked,
      reneged,
      abandoned,
      revenueUsd,
    };
  };
  return StationObservationsSchema.parse({
    version: STATION_OBSERVATION_VERSION,
    siteId: first.selected.siteId,
    config: first.config,
    settings: {
      averageTicketUsd,
      plannedStations,
      staffHeadcount,
      hours,
      demandMultiplier,
    },
    points: results.map((r) => ({
      seed: r.settings.seed,
      days: {
        weekday: metrics(r.days.weekday),
        weekend: metrics(r.days.weekend),
      },
      monthly: {
        revenueUsd: r.monthly.revenueUsd,
        contributionUsd: r.monthly.contributionUsd,
        staffHours: r.monthly.costs.staffHours,
      },
    })),
  });
}
