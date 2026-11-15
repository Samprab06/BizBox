"use client";
import { Button } from "@/components/ui/button";

import { useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InsightsDay } from "@/lib/contracts/insights";
import {
  EstimateValue,
  hour,
  hourRange,
  InsightFigure,
  money,
  number,
} from "./insights-frame";

const colors = {
  demand: "var(--sw-baseline)",
  served: "var(--sw-ink)",
  warn: "var(--sw-assumption-ink)",
  reneged: "var(--sw-alternative)",
};
const range = (value: { p5: number | null; p95: number | null }) =>
  value.p5 === null || value.p95 === null ? undefined : [value.p5, value.p95];
const tooltip = (value: unknown, currency: boolean) => {
  const format = currency ? money : number;
  return Array.isArray(value)
    ? value.map((item: unknown) => format(Number(item))).join("–")
    : typeof value === "number"
      ? format(value)
      : String(value);
};

function HourlyPlot({
  day,
  kind,
}: {
  day: InsightsDay;
  kind: "demand" | "wait" | "walkaways" | "revenue" | "cumulative";
}) {
  const rows = day.hours
    .filter((row) => !row.closed)
    .map((row) => ({
      hour: row.hour,
      arrivals: row.arrivals.mean,
      served: row.served.mean,
      capacity: row.capacityCustomers,
      arrivalsRange: range(row.arrivals),
      servedRange: range(row.served),
      wait: row.meanWaitMin.mean,
      p90: row.p90WaitMin.mean,
      waitRange: range(row.meanWaitMin),
      p90Range: range(row.p90WaitMin),
      balked: row.balked.mean,
      reneged: row.reneged.mean,
      walkawayRange: range(row.walkaways),
      revenue: row.revenueUsd.mean,
      revenueRange: range(row.revenueUsd),
      cumulative: row.cumulativeRevenueUsd.mean,
      cumulativeRange: range(row.cumulativeRevenueUsd),
    }));
  if (!rows.length)
    return <p role="status">No open-hour observations were retained.</p>;
  const currency = kind === "revenue" || kind === "cumulative";
  return (
    <div className="h-64 min-w-0 overflow-hidden">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 320, height: 256 }}
      >
        <ComposedChart
          data={rows}
          accessibilityLayer
          aria-label={kind + " by modeled local hour"}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="var(--sw-line)" vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={(value) => hour(Number(value))}
            interval="preserveStartEnd"
            minTickGap={28}
            tick={{ fill: "var(--sw-muted)", fontSize: 11 }}
          />
          <YAxis
            width={42}
            tickCount={5}
            domain={[0, "auto"]}
            tickFormatter={(value) =>
              Number(value).toLocaleString("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              })
            }
            tick={{ fill: "var(--sw-muted)", fontSize: 11 }}
          />
          <Tooltip
            isAnimationActive={false}
            formatter={(value) => tooltip(value, currency)}
            labelFormatter={(value) => hourRange(Number(value))}
            contentStyle={{
              background: "var(--sw-surface)",
              color: "var(--sw-ink)",
              borderColor: "var(--sw-muted)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {kind === "demand" && (
            <>
              <Area
                dataKey="arrivalsRange"
                name="Arrivals p5–p95"
                legendType="none"
                stroke={colors.demand}
                fill={colors.demand}
                fillOpacity={0.12}
                isAnimationActive={false}
              />
              <Area
                dataKey="servedRange"
                name="Served p5–p95"
                legendType="none"
                stroke={colors.served}
                fill={colors.served}
                fillOpacity={0.08}
                isAnimationActive={false}
              />
              <Bar
                dataKey="arrivals"
                name="Mean arrivals"
                fill={colors.demand}
                isAnimationActive={false}
                maxBarSize={28}
              />
              <Bar
                dataKey="served"
                name="Mean served"
                fill={colors.served}
                isAnimationActive={false}
                maxBarSize={28}
              />
              <Line
                dataKey="capacity"
                name="Capacity while open"
                stroke={colors.warn}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </>
          )}
          {kind === "wait" && (
            <>
              <Area
                dataKey="waitRange"
                name="Mean wait p5–p95"
                legendType="none"
                stroke={colors.demand}
                fill={colors.demand}
                fillOpacity={0.12}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Area
                dataKey="p90Range"
                name="P90 p5–p95"
                legendType="none"
                stroke={colors.warn}
                fill={colors.warn}
                fillOpacity={0.07}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="wait"
                name="Mean wait (min)"
                stroke={colors.served}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="p90"
                name="Mean within-seed p90"
                stroke={colors.warn}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </>
          )}
          {kind === "walkaways" && (
            <>
              <Area
                dataKey="walkawayRange"
                name="Total p5–p95"
                stroke={colors.served}
                fill={colors.served}
                fillOpacity={0.1}
                isAnimationActive={false}
              />
              <Bar
                dataKey="balked"
                name="Balked"
                stackId="walkaways"
                fill={colors.warn}
                isAnimationActive={false}
              />
              <Bar
                dataKey="reneged"
                name="Left queue"
                stackId="walkaways"
                fill={colors.reneged}
                isAnimationActive={false}
              />
            </>
          )}
          {currency && (
            <>
              <Area
                dataKey={
                  kind === "cumulative" ? "cumulativeRange" : "revenueRange"
                }
                name="p5–p95 (USD)"
                stroke={colors.demand}
                fill={colors.demand}
                fillOpacity={0.12}
                isAnimationActive={false}
              />
              <Line
                dataKey={kind}
                name={
                  kind === "cumulative"
                    ? "Mean cumulative revenue (USD)"
                    : "Mean hourly revenue (USD)"
                }
                stroke={colors.served}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DemandChart({ day }: { day: InsightsDay }) {
  const { capacityInputs: inputs } = day;
  return (
    <InsightFigure
      title="Demand vs capacity"
      summary="Mean arrivals and completed customers by local hour. Bands show each count's seed variation; the dashed line is capacity during actual open minutes."
      seedCount={day.seedCount}
      columns={[
        "Hour",
        "Open minutes",
        "Arrivals (p5–p95)",
        "Served (p5–p95)",
        "Capacity",
      ]}
      rows={day.hours.map((row) => ({
        key: String(row.hour),
        cells: [
          hourRange(row.hour),
          number(row.openMinutes),
          <EstimateValue key="arrivals" value={row.arrivals} />,
          <EstimateValue key="served" value={row.served} />,
          number(row.capacityCustomers),
        ],
      }))}
      note={
        <p>
          {inputs.stations} stations (
          {inputs.stationOrigin === null
            ? "station origin unknown"
            : inputs.stationOrigin}
          ) ·{" "}
          {inputs.meanServiceMin === null
            ? "service time unknown"
            : number(inputs.meanServiceMin) + " min service"}{" "}
          (
          {inputs.serviceMeanOrigin === null
            ? "service-time origin unknown"
            : inputs.serviceMeanOrigin}
          ). Capacity = stations × open minutes ÷ mean service minutes; unknown
          inputs stay unknown.
        </p>
      }
    >
      <HourlyPlot day={day} kind="demand" />
    </InsightFigure>
  );
}

export function WaitChart({ day }: { day: InsightsDay }) {
  return (
    <InsightFigure
      title="Wait by hour"
      summary="The solid line is mean wait; the dashed line is mean within-seed p90. Each shaded band is that metric's p5–p95 variation across observed seeds, not a confidence interval."
      seedCount={day.seedCount}
      columns={[
        "Hour",
        "Mean wait, min (p5–p95)",
        "Within-seed p90, min (p5–p95)",
        "Observed seeds",
      ]}
      rows={day.hours.map((row) => ({
        key: String(row.hour),
        cells: [
          hourRange(row.hour),
          <EstimateValue key="mean" value={row.meanWaitMin} />,
          <EstimateValue key="p90" value={row.p90WaitMin} />,
          row.waitObservedSeeds + " of " + day.seedCount,
        ],
      }))}
      note="Waits cover completed customers, grouped by service-start hour. Seed-hours without wait observations are omitted; gaps mean unknown, not zero. P90 is a tail statistic and is not forced above the mean."
    >
      <HourlyPlot day={day} kind="wait" />
    </InsightFigure>
  );
}

export function WalkawayChart({ day }: { day: InsightsDay }) {
  return (
    <InsightFigure
      title="Walk-aways by hour"
      summary="Stacked mean counts separate customers who balked from those who left a queue. The total band is computed from each seed's combined count before quantiles."
      seedCount={day.seedCount}
      columns={[
        "Hour",
        "Balked (p5–p95)",
        "Left queue (p5–p95)",
        "Total (p5–p95)",
      ]}
      rows={day.hours.map((row) => ({
        key: String(row.hour),
        cells: [
          hourRange(row.hour),
          <EstimateValue key="balked" value={row.balked} />,
          <EstimateValue key="reneged" value={row.reneged} />,
          <EstimateValue key="total" value={row.walkaways} />,
        ],
      }))}
      note="These are clock-hour counts. A customer may arrive in an earlier hour and leave later; dividing by this hour's arrivals would not be a cohort walk-away rate."
    >
      <HourlyPlot day={day} kind="walkaways" />
    </InsightFigure>
  );
}

export function RevenueChart({ day }: { day: InsightsDay }) {
  const [cumulative, setCumulative] = useState(false);
  return (
    <InsightFigure
      title="Modeled revenue"
      summary={
        cumulative
          ? "Cumulative USD through each local hour; each seed is accumulated before its mean and p5–p95 are calculated."
          : "Hourly USD from completed services, with mean and p5–p95 seed variation."
      }
      seedCount={day.seedCount}
      columns={["Hour", "Hourly USD (p5–p95)", "Cumulative USD (p5–p95)"]}
      rows={day.hours.map((row) => ({
        key: String(row.hour),
        cells: [
          hourRange(row.hour),
          <EstimateValue key="hourly" value={row.revenueUsd} currency />,
          <EstimateValue
            key="cumulative"
            value={row.cumulativeRevenueUsd}
            currency
          />,
        ],
      }))}
      note="These are modeled outcomes under supplied assumptions, not observed sales or guaranteed revenue."
    >
      <div
        role="group"
        aria-label="Revenue time basis"
        className="mb-3 flex flex-wrap gap-2"
      >
        {([false, true] as const).map((value) => (
          <Button
            variant={cumulative === value ? "primary" : "glass"}
            key={String(value)}
            type="button"
            aria-pressed={cumulative === value}
            className={
              "rounded-lg border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring text-xs font-semibold " +
              (cumulative === value
                ? "border-accent bg-accent text-on-accent"
                : "border-[var(--sw-muted)]")
            }
            onClick={() => setCumulative(value)}
          >
            {value ? "Cumulative revenue" : "Hourly revenue"}
          </Button>
        ))}
      </div>
      <HourlyPlot day={day} kind={cumulative ? "cumulative" : "revenue"} />
    </InsightFigure>
  );
}
