/**
 * HAC-95: hourly views of the comparison's representative runs. Every value comes from the
 * same run the table cites (its `runId`), through HAC-73's `hourlySeries`.
 */
import type { DayResult, SimEvent } from "@/lib/sim/contracts";
import { hourlySeries, peakHours } from "@/lib/sim/hourly";

export type HourPoint = {
  hour: number;
  arrivals: number;
  /** Customers the stations can serve in this hour at the run's mean service time. */
  capacity: number | null;
  p90WaitMin: number | null;
};

export type SiteHours = {
  siteId: string;
  runId: string;
  /** Open hours only, in order. */
  hours: HourPoint[];
  /** The open hour with the most arrivals (earliest on ties), or null with no arrivals. */
  peakHour: number | null;
};

/** Mean minutes from service start to completion for customers who finished. */
export function meanServiceMin(events: readonly SimEvent[]): number | null {
  const started = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const event of events) {
    if (event.type === "service_start")
      started.set(event.customerId, event.timeMin);
    else if (event.type === "completion") {
      const start = started.get(event.customerId);
      if (start === undefined) continue;
      total += event.timeMin - start;
      count++;
    }
  }
  return count && total > 0 ? total / count : null;
}

export function siteHours(
  siteId: string,
  runId: string,
  run: DayResult,
): SiteHours {
  const series = hourlySeries(run.events, run.metrics);
  const service = meanServiceMin(run.events);
  const [peak] = peakHours(series, 1).arrivals;
  return {
    siteId,
    runId,
    hours: series
      .filter((bucket) => !bucket.closed)
      .map((bucket) => ({
        hour: bucket.hour,
        arrivals: bucket.arrivals,
        capacity: service
          ? (run.metrics.stations * bucket.openMinutes) / service
          : null,
        p90WaitMin: bucket.p90WaitMin,
      })),
    peakHour: peak && peak.arrivals > 0 ? peak.hour : null,
  };
}

/** "7 AM", "12 PM". */
export function hourLabel(hour: number) {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}
