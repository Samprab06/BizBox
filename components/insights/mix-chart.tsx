"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InsightsDay } from "@/lib/contracts/insights";
import { EstimateValue, InsightFigure, number } from "./insights-frame";

export function MixChart({
  day,
  distance = false,
}: {
  day: InsightsDay;
  distance?: boolean;
}) {
  const values = distance
    ? ([
        ["<0.5 mi", day.mix.distanceCounts.underHalf],
        ["0.5–1 mi", day.mix.distanceCounts.halfToOne],
        ["1–3 mi", day.mix.distanceCounts.oneToThree],
        [">3 mi", day.mix.distanceCounts.overThree],
        ["Unknown", day.mix.distanceCounts.unknown],
      ] as const)
    : ([
        ["Residents", day.mix.kindCounts.resident],
        ["Workers", day.mix.kindCounts.worker],
        ["Pass-by", day.mix.kindCounts.passby],
        ["Unknown", day.mix.unknownKind],
      ] as const);
  const rows = values.map(([label, value]) => ({
    label,
    mean: value.mean,
    band: [value.p5, value.p95],
  }));
  return (
    <InsightFigure
      title={distance ? "Modeled arrival distance" : "Customer mix"}
      summary={
        distance
          ? "Straight-line distance from modeled persona locations to this site, for arrivals. These are not sampled trip origins."
          : "Modeled arrivals by resident, worker and pass-by group. Unknown classifications remain visible."
      }
      seedCount={day.seedCount}
      columns={["Group", "Mean arrivals (p5–p95)"]}
      rows={values.map(([label, value]) => ({
        key: label,
        cells: [label, <EstimateValue key="value" value={value} />],
      }))}
      note="Ranges describe the marginal distribution of each group across seeds. They are not a served-customer distribution or confidence interval."
    >
      <div className="h-64 min-w-0 overflow-hidden">
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          initialDimension={{ width: 320, height: 256 }}
        >
          <ComposedChart
            data={rows}
            layout="vertical"
            accessibilityLayer
            aria-label={
              distance
                ? "Modeled arrival distance counts"
                : "Modeled arrival customer mix"
            }
            margin={{ left: 0, right: 12, top: 0, bottom: 0 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--sw-line)" />
            <XAxis
              dataKey="mean"
              type="number"
              domain={[0, "auto"]}
              tick={{ fill: "var(--sw-muted)", fontSize: 11 }}
            />
            <YAxis
              dataKey="label"
              type="category"
              width={68}
              tick={{ fill: "var(--sw-muted)", fontSize: 11 }}
            />
            <Tooltip
              isAnimationActive={false}
              formatter={(value) =>
                Array.isArray(value)
                  ? value.map((item: unknown) => number(Number(item))).join("–")
                  : number(Number(value))
              }
              contentStyle={{
                background: "var(--sw-surface)",
                color: "var(--sw-ink)",
                borderColor: "var(--sw-muted)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="band"
              name="p5–p95"
              fill="var(--sw-baseline)"
              fillOpacity={0.2}
              stroke="var(--sw-baseline)"
              isAnimationActive={false}
            />
            <Scatter
              dataKey="mean"
              name="Mean"
              fill="var(--sw-ink)"
              shape="diamond"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </InsightFigure>
  );
}
