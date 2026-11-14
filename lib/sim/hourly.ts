/** Pure hourly views of a single engine day, and uncertainty across seed runs (HAC-73). */
import type {
  AggregatedHourlyMetrics,
  DailyMetrics,
  DayResult,
  HourlyEstimate,
  HourlyMetrics,
  HourlyValues,
  PeakHours,
  SimEvent,
} from "./contracts";
import { percentile } from "./engine";

/**
 * Consumes the chronological event stream and matching metrics returned by simulateDay.
 * No config or revenue calibration is needed: metadata and completion events carry both.
 * Does not mutate inputs. Same-day opening hours follow the engine's validated contract.
 */
export function hourlySeries(
  events: readonly SimEvent[],
  metrics: DailyMetrics,
): HourlyMetrics[] {
  const { openMin, closeMin, stations } = metrics;
  if (
    !Number.isFinite(openMin) ||
    !Number.isFinite(closeMin) ||
    openMin < 0 ||
    closeMin > 1440 ||
    closeMin <= openMin ||
    !Number.isInteger(stations) ||
    stations <= 0
  ) {
    throw new RangeError(
      "Hourly series requires valid same-day hours and a positive station count",
    );
  }
  const series: HourlyMetrics[] = Array.from({ length: 24 }, (_, hour) => {
    const openMinutes = Math.max(
      0,
      Math.min(closeMin, (hour + 1) * 60) - Math.max(openMin, hour * 60),
    );
    return {
      hour,
      openMinutes,
      closed: openMinutes === 0,
      arrivals: 0,
      joined: 0,
      served: 0,
      balked: 0,
      reneged: 0,
      meanWaitMin: null,
      p90WaitMin: null,
      meanQueueLength: 0,
      maxQueueLength: 0,
      stationUtilization: 0,
      revenueUsd: 0,
    };
  });
  const waits: number[][] = Array.from({ length: 24 }, () => []);
  const completed = new Set(
    events
      .filter((event) => event.type === "completion")
      .map((event) => event.customerId),
  );
  const lastOpenHour = Math.ceil(closeMin / 60) - 1;
  const eventHour = (timeMin: number) =>
    Math.min(Math.floor(timeMin / 60), lastOpenHour);
  let queued = 0;
  let busy = 0;
  let previousMin = openMin;

  // Integrate the state between events; equal-time transient states have no duration.
  const integrate = (endMin: number): void => {
    let startMin = previousMin;
    while (startMin < endMin) {
      const hour = Math.floor(startMin / 60);
      const until = Math.min(endMin, (hour + 1) * 60);
      const bucket = series[hour];
      bucket.meanQueueLength += queued * (until - startMin);
      bucket.maxQueueLength = Math.max(bucket.maxQueueLength, queued);
      bucket.stationUtilization += busy * (until - startMin);
      startMin = until;
    }
    previousMin = endMin;
  };

  for (const event of events) {
    integrate(event.timeMin);
    const hour = eventHour(event.timeMin);
    const bucket = series[hour];
    switch (event.type) {
      case "arrival":
        bucket.arrivals++;
        if (event.decision === "join") bucket.joined++;
        else bucket.balked++;
        break;
      case "queue_entry":
        queued++;
        break;
      case "service_start":
        queued--;
        busy++;
        if (completed.has(event.customerId)) waits[hour].push(event.waitMin);
        break;
      case "completion":
        busy--;
        bucket.served++;
        bucket.revenueUsd += event.revenueUsd;
        break;
      case "abandonment":
        queued--;
        bucket.reneged++;
        break;
    }
  }
  integrate(closeMin);
  for (const bucket of series) {
    if (bucket.openMinutes > 0) {
      bucket.meanQueueLength /= bucket.openMinutes;
      bucket.stationUtilization /= stations * bucket.openMinutes;
    }
    const samples = waits[bucket.hour].sort((a, b) => a - b);
    bucket.meanWaitMin = samples.length
      ? samples.reduce((sum, value) => sum + value, 0) / samples.length
      : null;
    bucket.p90WaitMin = percentile(samples, 0.9);
  }
  return series;
}

const FIELDS = [
  "arrivals",
  "joined",
  "served",
  "balked",
  "reneged",
  "meanWaitMin",
  "p90WaitMin",
  "meanQueueLength",
  "maxQueueLength",
  "stationUtilization",
  "revenueUsd",
] as const satisfies readonly (keyof HourlyValues)[];

function estimate(
  samples: readonly (number | null)[],
): HourlyEstimate<number | null> {
  const values = samples
    .filter((sample): sample is number => sample !== null)
    .sort((a, b) => a - b);
  return {
    mean: values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
    p5: percentile(values, 0.05),
    p95: percentile(values, 0.95),
  };
}

/**
 * Equal-weight seed estimates, with nearest-rank p5/p95 for every numeric observation.
 * Wait estimates omit seed-hours without served wait observations; all absent -> null.
 * Empty input returns []; incompatible opening hours throw rather than mix denominators.
 */
export function aggregateHourly(
  runs: readonly DayResult[],
): AggregatedHourlyMetrics[] {
  const first = runs[0];
  if (!first) return [];
  if (
    runs.some(
      ({ metrics }) =>
        metrics.openMin !== first.metrics.openMin ||
        metrics.closeMin !== first.metrics.closeMin,
    )
  ) {
    throw new RangeError("Hourly aggregation requires matching opening hours");
  }
  const series = runs.map(({ events, metrics }) =>
    hourlySeries(events, metrics),
  );
  return series[0].map(({ hour, closed, openMinutes }) => ({
    hour,
    closed,
    openMinutes,
    // Every field is enumerated above; non-wait fields always have a sample per run.
    ...Object.fromEntries(
      FIELDS.map((field) => [
        field,
        estimate(series.map((run) => run[hour][field])),
      ]),
    ),
  })) as AggregatedHourlyMetrics[];
}

/** Top n open buckets per observation; ties use earlier hour, absent waits are omitted. */
export function peakHours(
  series: readonly HourlyMetrics[],
  n: number,
): PeakHours {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError("Peak hour count must be a nonnegative integer");
  const open = series.filter((bucket) => !bucket.closed);
  return {
    arrivals: [...open]
      .sort((a, b) => b.arrivals - a.arrivals || a.hour - b.hour)
      .slice(0, n),
    p90WaitMin: open
      .filter((bucket) => bucket.p90WaitMin !== null)
      .sort(
        (a, b) =>
          (b.p90WaitMin as number) - (a.p90WaitMin as number) ||
          a.hour - b.hour,
      )
      .slice(0, n),
  };
}
