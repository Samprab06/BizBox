"use client";
import { Button } from "@/components/ui/button";

import { useId, useState, type ReactNode } from "react";
import { StationCallout, type StationCalloutDays } from "./station-callout";
import type { SiteInsights } from "@/lib/contracts/insights";
import { generateCoreCallouts } from "@/lib/insights/callouts";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import {
  DemandChart,
  RevenueChart,
  WaitChart,
  WalkawayChart,
} from "./hourly-charts";
import { MixChart } from "./mix-chart";
import { OriginMap } from "./origin-map";
import { hourRange, muted, number } from "./insights-frame";

/** Reusable in the site page or a downstream city drawer; accepts only retained aggregates. */
export function InsightsPanel({
  data,
  sourceLabel,
  surface,
  stationSlot,
  fixtureStationCallouts,
}: {
  data: SiteInsights;
  sourceLabel?: string;
  surface?: "paper" | "viewport";
  stationSlot?: ReactNode;
  fixtureStationCallouts?: StationCalloutDays;
}) {
  const [dayType, setDayType] = useState<"weekday" | "weekend">("weekday");
  const id = useId();
  const day = data.days[dayType];
  const callouts = generateCoreCallouts(day);
  return (
    <section
      aria-labelledby={id + "-title"}
      data-surface={surface}
      className="mt-8 min-w-0 border-t border-[var(--sw-line)] pt-5"
      style={{ color: "var(--sw-ink)", backgroundColor: "var(--sw-surface)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={id + "-title"} className="text-xl font-semibold">
            Insights
          </h3>
          <p className={"mt-1 text-sm " + muted}>
            {data.synthetic ? "Example data · " : ""}
            {sourceLabel ?? "Saved modeled scenarios"} · {data.seedCount} seeds
            per day
          </p>
        </div>
        <div role="group" aria-label="Insights day" className="flex gap-2">
          {(["weekday", "weekend"] as const).map((value) => (
            <Button
              variant={dayType === value ? "primary" : "glass"}
              type="button"
              key={value}
              aria-pressed={value === dayType}
              aria-controls={id + "-day"}
              className={
                "rounded-lg border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring text-sm font-semibold " +
                (dayType === value
                  ? "border-accent bg-accent text-on-accent"
                  : "border-[var(--sw-muted)]")
              }
              onClick={() => setDayType(value)}
            >
              {value === "weekday" ? "Weekday" : "Weekend"}
            </Button>
          ))}
        </div>
      </div>
      <p className={"mt-3 text-sm " + muted}>
        <EvidenceBadge kind="Simulation" /> Modeled, not a forecast. Seed bands
        describe variation under the supplied model, not a confidence interval.
      </p>
      <div
        id={id + "-day"}
        className="mt-5 space-y-5"
        aria-label={
          dayType === "weekday" ? "Weekday insights" : "Weekend insights"
        }
      >
        <ul
          aria-label="Modeled day highlights"
          className="grid min-w-0 gap-3 md:grid-cols-2"
        >
          {callouts.map((callout) => (
            <li
              key={callout.id}
              className="rounded-card border border-[var(--sw-line)] p-4 text-sm"
            >
              <strong>
                {callout.kind === "peak"
                  ? "Busiest modeled hour"
                  : "Quietest modeled hour"}{" "}
                · {hourRange(callout.hours[0])}
              </strong>
              {callout.kind === "peak" ? (
                <p className={"mt-1 " + muted}>
                  Mean arrivals{" "}
                  <data value={String(callout.values.arrivals)}>
                    {number(callout.values.arrivals)}
                  </data>{" "}
                  · balked {number(callout.values.balked)} · left queue{" "}
                  {number(callout.values.reneged)} · mean within-seed p90 wait{" "}
                  {callout.values.p90WaitMin === null
                    ? "Unknown"
                    : number(callout.values.p90WaitMin) + " min"}
                  .
                </p>
              ) : (
                <p className={"mt-1 " + muted}>
                  Mean station utilization{" "}
                  <data value={String(callout.values.utilization)}>
                    {number(callout.values.utilization * 100)}%
                  </data>{" "}
                  · {number(callout.values.arrivals)} arrivals.
                </p>
              )}
              <p className={"mt-2 text-xs " + muted}>
                {callout.source.seedCount} seeds · {callout.caption}
              </p>
            </li>
          ))}
          {(stationSlot || fixtureStationCallouts?.[dayType]) && (
            <li className="min-w-0 rounded-card border border-[var(--sw-line)] p-4 md:col-span-2">
              {stationSlot ??
                (fixtureStationCallouts?.[dayType] && (
                  <StationCallout
                    value={fixtureStationCallouts[dayType]!}
                    sourceLabel="Authored synthetic example · same baseline and paired seeds as these charts"
                  />
                ))}
            </li>
          )}
        </ul>
        <DemandChart day={day} />
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <WaitChart day={day} />
          <WalkawayChart day={day} />
        </div>
        <RevenueChart day={day} />
        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <MixChart day={day} />
          <MixChart day={day} distance />
        </div>
        <OriginMap day={day} />
      </div>
    </section>
  );
}
