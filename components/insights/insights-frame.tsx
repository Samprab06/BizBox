"use client";

import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { EvidenceBadge } from "@/components/ui/evidence-badge";

export const muted = "text-[var(--sw-muted)]";
export const number = (value: number | null) =>
  value === null
    ? "Unknown"
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const money = (value: number | null) =>
  value === null
    ? "Unknown"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      });
export const hour = (value: number) =>
  String(value % 12 || 12) + (value < 12 ? "am" : "pm");
export const hourRange = (value: number) =>
  hour(value) + "–" + hour((value + 1) % 24);

export function EstimateValue({
  value,
  currency = false,
}: {
  value: { mean: number | null; p5: number | null; p95: number | null };
  currency?: boolean;
}) {
  const format = currency ? money : number;
  return value.mean === null ? (
    <>Unknown</>
  ) : (
    <>
      <data value={String(value.mean)}>{format(value.mean)}</data> (
      {format(value.p5)}–{format(value.p95)})
    </>
  );
}

export function InsightFigure({
  title,
  summary,
  seedCount,
  children,
  rows,
  columns,
  note,
}: {
  title: string;
  summary: string;
  seedCount: number;
  children: ReactNode;
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <Card
      role="figure"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-summary"}
      className="min-w-0"
    >
      <h4 id={id + "-title"} className="text-base font-semibold">
        {title}
      </h4>
      <p id={id + "-summary"} className={"mt-2 text-sm " + muted}>
        {summary}
      </p>
      <div className="mt-4 min-w-0">{children}</div>
      <p className={"mt-3 text-xs " + muted}>
        <EvidenceBadge kind="Simulation" /> Mean and p5–p95 across {seedCount}{" "}
        seeds. Modeled, not a forecast.
      </p>
      {note && <div className={"mt-2 text-xs " + muted}>{note}</div>}
      <details className="mt-4 min-w-0">
        <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring">
          View {title.toLowerCase()} data
        </summary>
        <div
          tabIndex={0}
          role="region"
          aria-label={title + " data table"}
          className="mt-3 max-w-full overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <table className="w-full min-w-[28rem] text-left text-xs">
            <caption className={"pb-2 text-left " + muted}>
              Values are rounded for display; parentheses show p5–p95 seed
              variation, not a confidence interval.
            </caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th scope="col" key={column} className="p-2">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-[var(--sw-line)]">
                  {row.cells.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row" className="p-2 font-medium">
                        {cell}
                      </th>
                    ) : (
                      <td key={index} className="p-2 tabular-nums">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
