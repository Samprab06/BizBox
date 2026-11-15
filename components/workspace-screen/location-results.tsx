"use client";

import { focusRing, pressable, cn } from "@/components/ui/cn";

import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { WorkspaceCandidate } from "./client-model";
import { siteDemandLabel } from "@/lib/evaluation/demand-label";
import styles from "./workspace-glass.module.css";
import { ComparisonChart } from "./comparison-chart";
import { unitAddress } from "./client-model";

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
  framed = true,
}: {
  payload: LiveComparisonPayload;
  candidates: readonly WorkspaceCandidate[];
  onSelect: (id: string) => void;
  framed?: boolean;
}) {
  return (
    <section
      className={framed ? styles.comparison : undefined}
      aria-label="Location comparison results"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Location comparison</h2>
      </div>
      <div className="my-6 grid gap-7 xl:grid-cols-2">
        {["monthlyServedCustomers", "monthlyContributionUsd"].map((metric) => (
          <ComparisonChart
            key={metric}
            title={
              metric === "monthlyServedCustomers"
                ? "Est. customers / month"
                : "Est. operating contribution / month"
            }
            currency={metric === "monthlyContributionUsd"}
            points={payload.result.ranking.flatMap((id) => {
              const site = payload.result.sites.find(
                (entry) => entry.siteId === id,
              );
              if (!site) return [];
              return [
                {
                  id,
                  label: candidates.find((entry) => entry.candidate.id === id)
                    ? unitAddress(
                        candidates.find((entry) => entry.candidate.id === id)!,
                        candidates,
                      )
                    : "Saved unit",
                  ...(metric === "monthlyServedCustomers"
                    ? site.monthlyServedCustomers
                    : site.monthlyContributionUsd),
                },
              ];
            })}
          />
        ))}
      </div>
      <div className="overflow-x-auto" data-agent-anchor="comparison_table">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Server-calculated location results with modeled ranges
          </caption>
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th scope="col">Est. customers / mo</th>
              <th scope="col">Est. contribution / mo</th>
              <th scope="col">Wait</th>
            </tr>
          </thead>
          <tbody>
            {payload.result.ranking.map((id) => {
              const result = payload.result.sites.find((s) => s.siteId === id);
              if (!result) return null;
              const candidate = candidates.find((s) => s.candidate.id === id);
              return (
                <tr key={id}>
                  <th scope="row">
                    <button
                      className={cn(
                        "rounded-control text-left underline underline-offset-4",
                        focusRing,
                        pressable,
                      )}
                      onClick={() => onSelect(id)}
                    >
                      {candidate
                        ? unitAddress(candidate, candidates)
                        : "Saved unit"}
                    </button>
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
        <summary className="cursor-pointer text-xs">Details</summary>
        <p className="mt-2 text-xs">
          Modeled estimates ·{" "}
          {payload.result.demandSource === "jev" ? "Jev" : "Huff fallback"}. Not
          measured foot traffic.{" "}
          {payload.result.fallbackReason ??
            "Demand uses the returned model source."}{" "}
          {payload.result.jevModelVersion &&
            `Jev model: ${payload.result.jevModelVersion}.`}{" "}
          Contribution includes modeled operating costs; buildout amortization
          is separate.
        </p>
        <ul className="mt-2 list-disc pl-4 text-xs">
          {payload.result.sites.map((site) => {
            const label = siteDemandLabel(
              payload.result,
              site,
              payload.result.sites,
            );
            const address = candidates.find(
              (entry) => entry.candidate.id === site.siteId,
            )?.candidate.address;
            return label ? (
              <li key={site.siteId}>
                {address ?? "Saved location"}: {label}
              </li>
            ) : null;
          })}
          {payload.assembly?.findings.map((finding, index) => (
            <li key={index}>{finding.message}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
