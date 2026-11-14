import type { InsightsDay } from "@/lib/contracts/insights";

export type InsightCallout = {
  id: string;
  kind: "peak" | "quiet";
  dayType: InsightsDay["dayType"];
  hours: number[];
  values: {
    arrivals: number;
    served: number;
    balked: number;
    reneged: number;
    p90WaitMin: number | null;
    utilization: number;
    revenueUsd: number;
  };
  source: { mode: "aggregate"; seedCount: number };
  caption: "Modeled, not a forecast";
};

/** Factual numeric references only; presentation/rounding and station experiments are separate. */
export function generateCoreCallouts(day: InsightsDay): InsightCallout[] {
  const open = day.hours.filter((hour) => !hour.closed);
  if (!open.length) return [];
  const peak = [...open].sort(
    (a, b) => b.arrivals.mean - a.arrivals.mean || a.hour - b.hour,
  )[0];
  const quiet = [...open].sort(
    (a, b) =>
      a.stationUtilization.mean - b.stationUtilization.mean || a.hour - b.hour,
  )[0];
  const make = (
    kind: "peak" | "quiet",
    row: InsightsDay["hours"][number],
  ): InsightCallout => ({
    id: `${kind}-${day.dayType}-${row.hour}`,
    kind,
    dayType: day.dayType,
    hours: [row.hour],
    values: {
      arrivals: row.arrivals.mean,
      served: row.served.mean,
      balked: row.balked.mean,
      reneged: row.reneged.mean,
      p90WaitMin: row.p90WaitMin.mean,
      utilization: row.stationUtilization.mean,
      revenueUsd: row.revenueUsd.mean,
    },
    source: { mode: day.mode, seedCount: day.seedCount },
    caption: "Modeled, not a forecast",
  });
  return [
    ...(peak.arrivals.mean > 0 ? [make("peak", peak)] : []),
    make("quiet", quiet),
  ];
}
