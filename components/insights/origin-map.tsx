"use client";

import { useId } from "react";
import type { InsightsDay } from "@/lib/contracts/insights";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { EstimateValue, InsightFigure, muted, number } from "./insights-frame";

export function OriginMap({ day }: { day: InsightsDay }) {
  const map = day.servedOriginMap;
  const id = useId();
  if (map.status === "unavailable")
    return (
      <InsightFigure
        title="Served-customer origins"
        summary="Sampled trip origins are unavailable for this saved run."
        seedCount={day.seedCount}
        columns={["Availability"]}
        rows={[{ key: "unavailable", cells: [map.reason] }]}
      >
        <p
          role="status"
          className={
            "rounded-lg border border-[var(--sw-line)] p-4 text-sm " + muted
          }
        >
          {map.reason}
        </p>
      </InsightFigure>
    );

  const center = map.frame.center;
  const scaleX = Math.cos((center.lat * Math.PI) / 180);
  const points = map.cells.flatMap((cell) => cell.polygon);
  const project = (point: { lng: number; lat: number }) => ({
    x: (point.lng - center.lng) * scaleX,
    y: center.lat - point.lat,
  });
  const projected = points.map(project);
  const extent = Math.max(
    ...projected.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]),
    0.001,
  );
  const xy = (point: { lng: number; lat: number }) => {
    const p = project(point);
    return { x: 160 + (p.x / extent) * 130, y: 135 + (p.y / extent) * 105 };
  };
  const max = Math.max(...map.cells.map((cell) => cell.served.mean), 1);
  const authored = map.basis === "authored_synthetic_origins";
  return (
    <InsightFigure
      title="Served-customer origins"
      summary="Each hexagon shows the mean modeled served customers from explicitly supplied trip origins."
      seedCount={day.seedCount}
      columns={["Cell", "Mean served (p5–p95)", "Longitude", "Latitude"]}
      rows={map.cells.map((cell) => ({
        key: cell.key,
        cells: [
          cell.key,
          <EstimateValue key="estimate" value={cell.served} />,
          cell.center.lng.toFixed(5),
          cell.center.lat.toFixed(5),
        ],
      }))}
      note={
        <>
          <p>
            <EvidenceBadge kind={authored ? "Assumption" : "Simulation"} />{" "}
            {authored
              ? "Authored synthetic origins"
              : "Explicit sampled trip origins"}{" "}
            · {map.sourceLabel}
          </p>
          <p className="mt-1">
            Local hex grid; no street geometry is inferred. Unmapped served:{" "}
            <EstimateValue value={map.unmappedServed} />.
          </p>
        </>
      }
    >
      <svg
        role="img"
        aria-labelledby={id + "-title " + id + "-desc"}
        viewBox="0 0 320 270"
        className="h-64 w-full rounded-lg border border-[var(--sw-line)]"
      >
        <title id={id + "-title"}>Modeled served-origin hex map</title>
        <desc id={id + "-desc"}>
          {authored ? "Authored synthetic geography. " : ""}Darker cells mean
          more modeled served customers. A cross marks the site. Exact mean and
          seed ranges are in the data table.
        </desc>
        {map.cells.map((cell) => (
          <polygon
            key={cell.key}
            points={cell.polygon
              .map((point) => {
                const p = xy(point);
                return p.x + "," + p.y;
              })
              .join(" ")}
            fill="var(--sw-baseline)"
            fillOpacity={0.15 + (cell.served.mean / max) * 0.8}
            stroke="var(--sw-baseline)"
            strokeWidth="0.8"
          >
            <title>
              {cell.key +
                ": " +
                number(cell.served.mean) +
                " served; p5–p95 " +
                number(cell.served.p5) +
                "–" +
                number(cell.served.p95)}
            </title>
          </polygon>
        ))}
        <path
          d="M154 135h12M160 129v12"
          stroke="var(--sw-ink)"
          strokeWidth="2"
        />
        <text x="168" y="140" fill="var(--sw-ink)" fontSize="12">
          Site
        </text>
        <text x="16" y="22" fill="var(--sw-ink)" fontSize="12">
          N ↑
        </text>
        <text x="16" y="255" fill="var(--sw-muted)" fontSize="11">
          Mean served per cell · darker = more
        </text>
      </svg>
    </InsightFigure>
  );
}
