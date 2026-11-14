"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useSearchParams } from "next/navigation";
import { ComparisonDecisionScene } from "@/components/decision/comparison-decision-scene";
import { DecisionHeader } from "@/components/decision/decision-header";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import Link from "next/link";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import type {
  MetricSummary,
  SensitivityAssumption,
} from "@/lib/contracts/evaluation";
import type {
  LiveComparisonController,
  LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { siteDemandLabel } from "@/lib/evaluation/demand-label";

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const count = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const percent = (value: number) =>
  value.toLocaleString("en-US", { style: "percent", maximumFractionDigits: 1 });
const range = (metric: MetricSummary, format: (value: number) => string) =>
  `${format(metric.low)} to ${format(metric.high)}`;
const assumptions: { value: SensitivityAssumption; label: string }[] = [
  { value: "rent", label: "Rent ±10%" },
  { value: "ticket_size", label: "Average ticket" },
  { value: "market_share_scale", label: "Market share" },
  { value: "price", label: "Price" },
  { value: "visit_frequency", label: "Visit frequency" },
];

export function LiveComparisonScreen({
  project,
  controller,
  example,
}: {
  project: PreviewProject;
  controller: LiveComparisonController;
  example: ReactNode;
}) {
  const { phase, candidates, payload } = controller;
  const requested = useSearchParams().get("sensitivity");
  const requestedAssumption = assumptions.find(
    ({ value }) => value === requested,
  )?.value;
  const [selection, setSelection] = useState<{
    requested: SensitivityAssumption | undefined;
    value: SensitivityAssumption;
  }>({ requested: requestedAssumption, value: requestedAssumption ?? "rent" });
  const assumption =
    selection.requested === requestedAssumption
      ? selection.value
      : (requestedAssumption ?? "rent");
  const setAssumption = (value: SensitivityAssumption) =>
    setSelection({ requested: requestedAssumption, value });
  const sensitivitySelect = useRef<HTMLSelectElement>(null);
  const busy = phase === "running";
  const nextAssumption = assumptions.find(
    ({ value }) => value === payload?.robustness?.mostInfluential?.assumption,
  );
  const readyComparisonId = payload?.comparisonId;
  useEffect(() => {
    if (requestedAssumption && readyComparisonId && phase === "ready")
      sensitivitySelect.current?.focus();
  }, [requestedAssumption, readyComparisonId, phase]);
  const address = (siteId: string) =>
    candidates.find(({ candidate }) => candidate.id === siteId)?.candidate
      .address ?? siteId;
  if (phase === "loading")
    return <p role="status">Loading comparison and candidate sites…</p>;
  if (phase === "example")
    return (
      <div className="min-w-0 space-y-6">
        <div className="rounded-lg bg-paper p-4">
          <p role="alert">{controller.message}</p>
          <Link
            className="mt-3 inline-block font-semibold text-pine underline"
            href={workspaceHref(project.id, "intake")}
          >
            Review intake
          </Link>
          <button
            type="button"
            className="ml-4 rounded bg-pine px-3 py-2 text-white"
            onClick={controller.retry}
          >
            Retry comparison
          </button>
        </div>
        {example}
      </div>
    );
  return (
    <div className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
      {payload && (
        <DecisionHeader
          compact
          decision="Which site should I choose?"
          scene={
            <ComparisonDecisionScene
              projectId={project.id}
              payload={payload}
              address={address}
            />
          }
          answer={
            payload.robustness
              ? nameSites(payload.robustness.headline, payload, address)
              : "Recommendation robustness is unavailable for this saved comparison."
          }
          qualification={
            <>
              <p>
                <EvidenceBadge kind="Simulation" /> Modeled, not a forecast.
              </p>
              {payload.outdated && (
                <p role="status" className="font-semibold text-warn">
                  This comparison is outdated. The saved profile has changed;
                  rerun to use the latest intake.
                </p>
              )}
              {busy && (
                <p role="status">
                  A new comparison is running; the answer shown is from the
                  saved comparison.
                </p>
              )}
              {payload.robustness ? (
                <RobustnessDetails payload={payload} />
              ) : (
                <p>
                  Review the modeled ranges and assumptions before deciding.
                </p>
              )}
            </>
          }
          nextAction={
            payload.outdated ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-pine px-4 py-2 font-semibold text-on-pine disabled:opacity-50"
                onClick={() => {
                  void controller.run();
                }}
              >
                Rerun with current intake
              </button>
            ) : nextAssumption ? (
              <button
                type="button"
                disabled={busy || controller.sensitivity.loading}
                className="rounded-lg bg-pine px-4 py-2 font-semibold text-on-pine disabled:opacity-50"
                onClick={() => {
                  setAssumption(nextAssumption.value);
                  sensitivitySelect.current?.focus();
                }}
              >
                Change {nextAssumption.label.toLowerCase()}
              </button>
            ) : (
              <a
                href="#comparison-evidence"
                className="font-semibold text-pine underline"
              >
                Open the evidence
              </a>
            )
          }
        />
      )}
      <div>
        <h2 className="text-2xl font-semibold">Compare live candidate sites</h2>
        <p className="mt-2 text-sm text-muted">
          Choose up to eight sites from your intake’s current search. A
          comparison runs only when you choose Run comparison.
        </p>
        <p className="mt-2 text-sm text-muted">
          Run uses {controller.demandSource === "jev" ? "Jev" : "Huff"} demand.{" "}
          {controller.demandSourceReason}
        </p>
        {controller.notes.map((note) => (
          <p className="mt-2 text-sm text-muted" key={note}>
            {note}
          </p>
        ))}
      </div>
      <fieldset
        disabled={busy}
        className="min-w-0 rounded-xl border border-line p-4"
      >
        <legend className="px-1 font-semibold">Sites to compare</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {candidates.map(({ candidate }) => (
            <label
              key={candidate.id}
              className="flex min-w-0 items-start gap-3 rounded-lg border border-line p-3"
            >
              <input
                type="checkbox"
                className="mt-1 accent-pine"
                checked={controller.selectedIds.includes(candidate.id)}
                onChange={(event) =>
                  controller.setSelectedIds(
                    event.target.checked
                      ? [...controller.selectedIds, candidate.id].slice(0, 8)
                      : controller.selectedIds.filter(
                          (id) => id !== candidate.id,
                        ),
                  )
                }
              />
              <span className="min-w-0 text-sm">
                <strong className="block">{candidate.address}</strong>
                {candidate.name} · {candidate.city}
              </span>
            </label>
          ))}
        </div>
        {!candidates.length && (
          <p role="status">
            {controller.message || "No candidate sites match this intake."}
          </p>
        )}
        {candidates.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            {controller.selectedIds.length} selected. Selections apply to the
            next comparison.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !controller.selectedIds.length}
          className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
          onClick={() => {
            void controller.run();
          }}
        >
          {busy
            ? "Running comparison…"
            : payload?.outdated
              ? "Rerun comparison"
              : "Run comparison"}
        </button>
        {!busy && (
          <button
            type="button"
            className="font-semibold text-pine underline"
            onClick={controller.retry}
          >
            Refresh candidates
          </button>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted">
            Evaluating seeded weekday and weekend scenarios. This can take a few
            seconds.
          </p>
        )}
      </div>
      {controller.message && candidates.length > 0 && (
        <p role="status" className="text-sm text-muted">
          {controller.message}
        </p>
      )}
      {payload && (
        <>
          <ComparisonResults
            projectId={project.id}
            payload={payload}
            address={address}
          />
          <Sensitivity
            controller={controller}
            address={address}
            disabled={busy}
            assumption={assumption}
            onAssumptionChange={setAssumption}
            selectRef={sensitivitySelect}
          />
          <ComparisonEvidence payload={payload} />
          {!payload.outdated && (
            <Link
              className="inline-block font-semibold text-pine underline"
              href={`/projects/${encodeURIComponent(project.id)}/plan?comparison=${encodeURIComponent(payload.comparisonId)}`}
            >
              Export the location plan
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function ComparisonResults({
  projectId,
  payload,
  address,
}: {
  projectId: string;
  payload: LiveComparisonPayload;
  address: (id: string) => string;
}) {
  const { result } = payload;
  const rows = result.ranking
    .map((id) => result.sites.find((site) => site.siteId === id))
    .filter((site) => site !== undefined);
  return (
    <>
      <section
        aria-label="Comparison provenance"
        className="rounded-xl border border-line p-4 text-sm"
      >
        <h3 className="font-semibold">Monthly operating scenarios</h3>
        <p className="mt-2">
          Ranked by mean monthly contribution after included costs. The 90%
          intervals show modeled outcomes across seeds, not guaranteed sales.
        </p>
        <p className="mt-2">
          Demand source: {result.demandSource === "jev" ? "Jev" : "Huff"}
        </p>
        {result.derivation && (
          <p className="mt-2">
            How these numbers were made:{" "}
            {result.derivation.inputs === "public"
              ? "public census and jobs data"
              : "example inputs"}{" "}
            → synthetic customer personas →{" "}
            {result.derivation.behaviorModel === "jev" ? "Jev" : "Huff"}{" "}
            behaviour model →{" "}
            {result.derivation.calibration === "founder"
              ? "calibrated to your own figures"
              : "not calibrated to observed sales"}{" "}
            → modelled arrivals. These are modelled, not observed.
          </p>
        )}
        {result.fallbackReason && (
          <p className="mt-2">Fallback reason: {result.fallbackReason}</p>
        )}
        {payload.demandSourceCheck && (
          <p className="mt-2">
            Huff-only check:{" "}
            {payload.demandSourceCheck.rankingMatches
              ? "the ranking matches."
              : payload.demandSourceCheck.topMatches
                ? "the top site matches; lower ranks differ"
                : "the top site differs"}
            {!payload.demandSourceCheck.rankingMatches &&
              ` (Huff order: ${payload.demandSourceCheck.huffRanking.map(address).join(", ")}).`}
          </p>
        )}
        <p className="mt-2">Seeds: {result.seeds.join(", ")}</p>
        <p className="mt-2">
          Model: {result.modelVersion}
          {result.jevModelVersion && ` · Jev ${result.jevModelVersion}`}
        </p>
        <p className="mt-2">
          Profile snapshot version: {result.profileVersion}
        </p>
      </section>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="pb-3 text-left text-muted">
            Live comparison {payload.comparisonId} · monthly contribution in USD
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pr-4">
                Rank and space
              </th>
              <th scope="col" className="pr-4">
                Mean monthly contribution
              </th>
              <th scope="col" className="pr-4">
                90% interval
              </th>
              <th scope="col">Representative runs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((site) => (
              <tr key={site.siteId} className="border-t border-line">
                <th scope="row" className="py-4 pr-4">
                  {site.rank}. {address(site.siteId)}
                  {siteDemandLabel(result, site, result.sites) && (
                    <span className="mt-1 block text-xs font-medium text-muted">
                      {siteDemandLabel(result, site, result.sites)}
                    </span>
                  )}
                  {site.tiedWith.length > 0 && (
                    <span className="mt-1 block text-xs font-medium text-muted">
                      Modeled tie · overlapping intervals with{" "}
                      {site.tiedWith.map(address).join(", ")}
                    </span>
                  )}
                </th>
                <td className="pr-4">
                  {money(site.monthlyContributionUsd.mean)}
                </td>
                <td className="pr-4">
                  {range(site.monthlyContributionUsd, money)}
                </td>
                <td>
                  {(["weekday", "weekend"] as const).map((day) => (
                    <Link
                      key={day}
                      className="my-1 block font-semibold text-pine underline"
                      href={`${workspaceHref(projectId, "replay", site.siteId)}&comparison=${encodeURIComponent(payload.comparisonId)}&day=${day}`}
                    >
                      Replay {day}
                    </Link>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {rows.map((site) => (
          <section
            key={site.siteId}
            aria-label={`Operating ranges for ${address(site.siteId)}`}
            className="min-w-0 rounded-xl border border-line p-4"
          >
            <h3 className="font-semibold">{address(site.siteId)}</h3>
            <p className="mt-1 text-xs text-muted">90% modeled intervals</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm">
              {[
                ["Monthly revenue", range(site.monthlyRevenueUsd, money)],
                [
                  "Served customers per month",
                  range(site.monthlyServedCustomers, count),
                ],
                [
                  "Weekday mean wait",
                  `${range(site.weekdayMeanWaitMin, count)} minutes`,
                ],
                [
                  "Weekday abandonment",
                  range(site.weekdayAbandonmentRate, percent),
                ],
                [
                  "Weekday utilization",
                  range(site.weekdayUtilization, percent),
                ],
                [
                  "Contribution after buildout",
                  range(site.monthlyContributionAfterBuildoutUsd, money),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

function Sensitivity({
  controller,
  address,
  disabled,
  assumption,
  onAssumptionChange,
  selectRef,
}: {
  controller: LiveComparisonController;
  address: (id: string) => string;
  disabled: boolean;
  assumption: SensitivityAssumption;
  onAssumptionChange: (value: SensitivityAssumption) => void;
  selectRef: RefObject<HTMLSelectElement | null>;
}) {
  const { sensitivity } = controller;
  return (
    <section
      aria-label="Sensitivity"
      className="min-w-0 rounded-xl border border-line p-4"
    >
      <h3 className="font-semibold">Sensitivity</h3>
      <p className="mt-2 text-sm text-muted">
        Vary one assumption using the saved comparison inputs. Rent spans 90% to
        110% of its baseline; other sweeps use the server’s scenario values.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Sensitivity assumption
          <select
            ref={selectRef}
            id="comparison-sensitivity"
            className="max-w-full rounded-lg border border-line p-2"
            value={assumption}
            disabled={disabled || sensitivity.loading}
            onChange={(event) =>
              onAssumptionChange(event.target.value as SensitivityAssumption)
            }
          >
            {assumptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
          disabled={disabled || sensitivity.loading}
          onClick={() => {
            void controller.runSensitivity(assumption);
          }}
        >
          {sensitivity.loading ? "Running sensitivity…" : "Run sensitivity"}
        </button>
      </div>
      {sensitivity.loading && (
        <p role="status" className="mt-3 text-sm">
          Evaluating sensitivity…
        </p>
      )}
      {sensitivity.error && (
        <p role="alert" className="mt-3 text-sm">
          {sensitivity.error}
        </p>
      )}
      {sensitivity.result && (
        <div className="mt-4 space-y-3 text-sm">
          <h4 className="font-semibold">
            {assumptions.find(
              (option) => option.value === sensitivity.result!.assumption,
            )?.label ?? sensitivity.result.assumption}{" "}
            result
          </h4>
          <p className="font-medium">{sensitivity.result.conclusion}</p>
          <p>
            Top site{" "}
            {sensitivity.result.topChanges ? "changes" : "does not change"} in
            the tested range. Baseline leader:{" "}
            {address(sensitivity.result.baselineTopSiteId)}.
          </p>
          <p>
            {sensitivity.result.breakEven
              ? `Break-even: ${sensitivity.result.unit === "usd" ? money(sensitivity.result.breakEven.value) : `${count(sensitivity.result.breakEven.value)}× baseline`} · ${address(sensitivity.result.breakEven.fromSiteId)} to ${address(sensitivity.result.breakEven.toSiteId)}.`
              : "Break-even: no ranking change found within the tested range."}
          </p>
          <ul className="space-y-2">
            {sensitivity.result.points.map((point, index) => (
              <li key={index}>
                {sensitivity.result!.unit === "usd"
                  ? money(point.value)
                  : `${count(point.value)}× baseline`}
                : {address(point.topSiteId)} leads.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ComparisonEvidence({ payload }: { payload: LiveComparisonPayload }) {
  const assembly = payload.assembly;
  return (
    <aside
      id="comparison-evidence"
      tabIndex={-1}
      aria-label="Comparison assumptions and findings"
      className="grid min-w-0 grid-cols-1 gap-4 border-t border-line pt-5 text-sm"
    >
      <h3 className="font-semibold">Assumptions and findings</h3>
      {assembly ? (
        <>
          {assembly.findings.length > 0 ? (
            <ul className="space-y-2">
              {assembly.findings.map((finding, index) => (
                <li key={index}>
                  {finding.message}
                  {finding.siteId && (
                    <span className="text-muted"> · {finding.siteId}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No assembly findings were returned.</p>
          )}
          <dl className="grid min-w-0 grid-cols-1 gap-3">
            {Object.entries(assembly.assumptions).map(([path, assumption]) => (
              <div key={path} className="min-w-0">
                <dt className="text-muted">{path}</dt>
                <dd className="mt-1">
                  {count(assumption.value)} · {assumption.origin}
                  <span className="block text-xs text-muted">
                    Evidence: {assumption.evidenceIds.join(", ")}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>
          Detailed assembly provenance was not returned with this saved
          comparison.
        </p>
      )}
      <p className="text-muted">
        These are simulated scenarios, not observed sales. Confirm rent,
        operating costs, and demand assumptions before a lease decision.
      </p>
    </aside>
  );
}

function nameSites(
  text: string,
  payload: LiveComparisonPayload,
  address: (id: string) => string,
) {
  // Replace longest IDs first so an ID that prefixes another cannot corrupt its label.
  return payload.result.sites
    .toSorted((a, b) => b.siteId.length - a.siteId.length)
    .reduce(
      (value, site) => value.replaceAll(site.siteId, address(site.siteId)),
      text,
    );
}

function RobustnessDetails({ payload }: { payload: LiveComparisonPayload }) {
  const robustness = payload.robustness!;
  return (
    <>
      <ul className="space-y-1">
        {robustness.jevHuffAgree !== null && (
          <li>
            {robustness.jevHuffAgree
              ? "Jev and Huff agree on the leader."
              : "Jev and Huff disagree on the leader; ranking is uncertain."}
          </li>
        )}
      </ul>
      {(robustness.robustTo.length > 0 ||
        robustness.missingInformation.length > 0) && (
        <details>
          <summary className="cursor-pointer font-semibold text-pine">
            Decision evidence
          </summary>
          <ul className="mt-2 space-y-1">
            {" "}
            {robustness.robustTo.length > 0 && (
              <li>
                The lead holds across the tested changes in{" "}
                {robustness.robustTo
                  .map((a) => a.replaceAll("_", " "))
                  .join(", ")}
                .
              </li>
            )}
          </ul>
          {robustness.missingInformation.length > 0 && (
            <>
              <h4 className="mt-3 font-semibold">
                What would most improve this decision
              </h4>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {robustness.missingInformation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </>
          )}
        </details>
      )}
    </>
  );
}
