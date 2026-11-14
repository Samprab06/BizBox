"use client";

import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { WorkspaceCandidate } from "./client-model";
import { siteDemandLabel } from "@/lib/evaluation/demand-label";
import styles from "./workspace-glass.module.css";

const count = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function LocationResults({
  payload,
  candidates,
  onSelect,
}: {
  payload: LiveComparisonPayload;
  candidates: readonly WorkspaceCandidate[];
  onSelect: (id: string) => void;
}) {
  return (
    <section
      className={styles.comparison}
      aria-label="Location comparison results"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Compare locations</h2>
        <span className={styles.badge}>
          Modeled ·{" "}
          {payload.result.demandSource === "jev" ? "Jev" : "Huff fallback"}
        </span>
      </div>
      <p className={styles.muted}>
        Same business brief. Estimates reflect the saved assumptions; they are
        not measured foot traffic.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Server-calculated location results with modeled ranges
          </caption>
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th scope="col">Customers / month</th>
              <th scope="col">Contribution / month</th>
              <th scope="col">Wait</th>
            </tr>
          </thead>
          <tbody>
            {payload.result.ranking.map((id) => {
              const result = payload.result.sites.find((s) => s.siteId === id);
              if (!result) return null;
              const candidate = candidates.find(
                (s) => s.candidate.id === id,
              )?.candidate;
              const label = siteDemandLabel(
                payload.result,
                result,
                payload.result.sites,
              );
              return (
                <tr key={id}>
                  <th scope="row">
                    <button
                      className="text-left underline underline-offset-4"
                      onClick={() => onSelect(id)}
                    >
                      {candidate?.address ?? "Saved location"}
                    </button>
                    {label && (
                      <span className="block text-xs font-normal">{label}</span>
                    )}
                  </th>
                  <td>
                    {count(result.monthlyServedCustomers.mean)}
                    <span className="block text-xs opacity-75">
                      {count(result.monthlyServedCustomers.low)}–
                      {count(result.monthlyServedCustomers.high)}
                    </span>
                  </td>
                  <td>
                    {money(result.monthlyContributionUsd.mean)}
                    <span className="block text-xs opacity-75">
                      {money(result.monthlyContributionUsd.low)}–
                      {money(result.monthlyContributionUsd.high)}
                    </span>
                  </td>
                  <td>{result.weekdayMeanWaitMin.mean.toFixed(1)} min</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary className="cursor-pointer text-xs">
          Sources and assumptions
        </summary>
        <p className="mt-2 text-xs">
          {payload.result.fallbackReason ??
            "Demand uses the returned model source."}{" "}
          {payload.result.jevModelVersion &&
            `Jev model: ${payload.result.jevModelVersion}.`}{" "}
          Contribution includes modeled operating costs; buildout amortization
          is separate.
        </p>
        <ul className="mt-2 list-disc pl-4 text-xs">
          {payload.assembly?.findings.map((finding, index) => (
            <li key={index}>{finding.message}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
