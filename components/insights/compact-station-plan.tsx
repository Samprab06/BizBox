"use client";

import { Button } from "@/components/ui/button";
import type { StationExperimentRun } from "@/lib/contracts/station-experiment-run";
import { StationCallout, StationRange } from "./station-callout";
import styles from "./compact-station-plan.module.css";

export type CompactStationPlanProps = {
  plan: StationExperimentRun | null;
  loading: boolean;
  writing: boolean;
  needsRead: boolean;
  error: string | null;
  onRun: (confirm: boolean) => void;
  onRefresh: () => void;
};

/** Workspace presentation only; its controller owns all reads, writes and guards. */
export function CompactStationPlan({
  plan,
  loading,
  writing,
  needsRead,
  error,
  onRun,
  onRefresh,
}: CompactStationPlanProps) {
  const result = plan?.result;
  const selected = result?.status === "available" ? result.selected : null;
  const noRoom =
    plan?.status === "unavailable" &&
    plan.unavailable?.code === "no_effective_variants";
  const names = {
    baseline: "Current",
    "plus-one": "+1 counter",
    "plus-two": "+2 counters",
  };
  const states = {
    planned: "Ready",
    queued: "Queued",
    running: "Running",
    succeeded: "Done",
    failed: "Failed",
  };
  return (
    <section
      className={styles.root}
      aria-label="Station experiment"
      aria-busy={loading || writing}
    >
      {loading && <p role="status">Loading setup…</p>}
      {error && (
        <p role="alert">
          {needsRead
            ? "Status uncertain. Refresh before continuing."
            : "Couldn’t load setup. Refresh to retry."}
        </p>
      )}
      {plan?.source.outdated && <p role="status">Out of date</p>}
      {plan &&
        (plan.source.outdated === null ||
          plan.source.currentProfileVersion === null) && (
          <p role="status">Freshness unverified</p>
        )}
      {noRoom ? (
        <p role="status">No space for extra counters</p>
      ) : plan?.status === "unavailable" ? (
        <p role="status">Counter setup unavailable</p>
      ) : null}
      {!!plan?.configurations.length && (
        <ul className={styles.options} aria-label="Counter configurations">
          {plan.configurations.map((config) => (
            <li key={config.id}>
              <strong>{names[config.id]}</strong>
              <span>
                {config.effectiveStations} counters · {config.staffHeadcount}{" "}
                staff
              </span>
              <span>{states[config.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {writing && <p role="status">Running setup comparison…</p>}
      {plan?.confirmation && (
        <p role="status">
          Cost {plan.confirmation.costUnits} units ·{" "}
          {plan.confirmation.remainingUnits} remaining
        </p>
      )}
      {selected && (
        <p>
          Selected setup: {selected.change.toEffectiveStations} counters ·{" "}
          {selected.change.toStaffHeadcount} staff
        </p>
      )}
      {selected && (
        <dl className={styles.metrics}>
          <div>
            <dt>Added revenue / month</dt>
            <dd>
              <StationRange value={selected.monthlyRevenueChangeUsd} currency />
            </dd>
          </div>
          <div>
            <dt>Contribution change / month</dt>
            <dd>
              <StationRange
                value={selected.monthlyContributionChangeUsd}
                currency
              />
            </dd>
          </div>
        </dl>
      )}
      {plan?.status === "ready" &&
        result?.status === "available" &&
        !selected && <p role="status">No revenue improvement found</p>}
      <div className={styles.actions}>
        {plan?.nextConfigurationId && plan.status !== "unavailable" && (
          <Button
            type="button"
            variant="quiet"
            disabled={loading || writing || needsRead || !!error}
            onClick={() => onRun(plan.status === "needs_confirmation")}
          >
            {writing
              ? "Running…"
              : plan.status === "needs_confirmation"
                ? `Confirm ${plan.confirmation?.costUnits ?? ""} units`
                : "Compare setups"}
          </Button>
        )}
        <Button
          type="button"
          variant="quiet"
          aria-label="Refresh counter setup"
          disabled={loading || writing}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
      {(plan || error) && (
        <details className={styles.details}>
          <summary>Details</summary>
          <p>
            Whole-day counter and staff changes use the saved assumptions and
            paired seeds. Opening this section does not run a comparison.
          </p>
          {error && <p>{error}</p>}
          {selected && result?.status === "available" && (
            <StationCallout
              value={selected}
              sourceLabel={`Saved current setup ${result.identity.baselineComparisonId}`}
            />
          )}
          {plan && <pre>{JSON.stringify(plan, null, 2)}</pre>}
        </details>
      )}
    </section>
  );
}
