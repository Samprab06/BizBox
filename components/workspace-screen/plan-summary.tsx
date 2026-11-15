"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Pill } from "@/components/ui/pill";
import { cn, focusRing, pressable } from "@/components/ui/cn";
import { flowStepHref, useFlowProgress } from "@/lib/client/flow-progress";
import {
  demandSourceLabel,
  describeTweaks,
  formatCount,
  formatFinalizedAt,
  formatMinutes,
  formatRange,
  formatUsd,
  formatUsdDelta,
  runnerUpGap,
  type SummaryRange,
} from "@/lib/client/final-plan";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { FinalPlanSummary } from "@/lib/contracts/plan";
import { comparisonScale } from "./comparison-chart";
import styles from "./plan-summary.module.css";

export const MODELED_NOTE = "Modeled estimate, not measured traffic";
export const EMPTY_MESSAGE =
  "Finish the comparison with your consultant to see your plan";

export type PlanSummaryProps = {
  projectId: string;
  /** The summary to show; without it the project's stored final plan is used. */
  summary?: FinalPlanSummary | null;
  className?: string;
};

/**
 * Scene 1 "Final plan" step: the finalized location, its modeled outlook, what was tweaked,
 * the runner-up, risks and next steps, with a link to the printable plan.
 */
export function PlanSummary({
  projectId,
  summary,
  className,
}: PlanSummaryProps) {
  const { state } = useFlowProgress(projectId);
  const plan = summary ?? state.finalPlan;
  return plan ? (
    <PlanSummaryView
      projectId={projectId}
      summary={plan}
      className={className}
    />
  ) : (
    <EmptyPlan projectId={projectId} className={className} />
  );
}

function EmptyPlan({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      data-agent-anchor="plan_summary"
      aria-labelledby={titleId}
      className={cn(styles.root, styles.empty, className)}
    >
      <p className={styles.eyebrow}>Final plan</p>
      <h2 id={titleId} className={styles.emptyTitle}>
        No plan yet
      </h2>
      <p className={styles.muted}>{EMPTY_MESSAGE}.</p>
      <Link
        href={flowStepHref(projectId, "results")}
        className={cn(styles.secondaryAction, focusRing, pressable)}
      >
        Back to results
      </Link>
    </section>
  );
}

function PlanSummaryView({
  projectId,
  summary,
  className,
}: {
  projectId: string;
  summary: FinalPlanSummary;
  className?: string;
}) {
  const ids = {
    title: useId(),
    metrics: useId(),
    tweaks: useId(),
    runnerUp: useId(),
    risks: useId(),
    steps: useId(),
  };
  const tweaks = describeTweaks(summary.tweaks);
  const { metrics } = summary;
  const exportHref = workspaceHref(
    projectId,
    "plan",
    undefined,
    summary.comparisonId,
  );

  return (
    <section
      data-agent-anchor="plan_summary"
      aria-labelledby={ids.title}
      className={cn(styles.root, className)}
    >
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <p className={styles.eyebrow}>Final plan</p>
          <Pill tone="accent">Recommended</Pill>
        </div>
        <h2 id={ids.title} className={styles.address}>
          {summary.chosenAddress}
        </h2>
        <p className={styles.rationale}>
          <span className={styles.rationaleLabel}>Why this location</span>
          {summary.rationale}
        </p>
        <p className={styles.meta}>
          Demand: {demandSourceLabel(summary.demandSource)} · Modeled estimates,
          not measured traffic
        </p>
      </header>

      <section aria-labelledby={ids.metrics} className={styles.block}>
        <h3 id={ids.metrics} className={styles.heading}>
          Modeled outlook
        </h3>
        <ul className={styles.metrics}>
          <MetricCard
            label="Customers / month"
            range={metrics.monthlyServedCustomers}
            format={formatCount}
          />
          <MetricCard
            label="Operating contribution / month"
            range={metrics.monthlyContributionUsd}
            format={formatUsd}
            signed
          />
          <MetricCard
            label="Weekday wait"
            range={metrics.weekdayMeanWaitMin}
            format={formatMinutes}
          />
        </ul>
      </section>

      <div className={styles.columns}>
        <div className={styles.column}>
          {tweaks.length > 0 && (
            <section aria-labelledby={ids.tweaks} className={styles.block}>
              <h3 id={ids.tweaks} className={styles.heading}>
                Applied changes
              </h3>
              <dl className={styles.tweaks}>
                {tweaks.map((line) => (
                  <div key={line.key} className={styles.tweak}>
                    <dt>{line.label}</dt>
                    <dd>{line.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section aria-labelledby={ids.runnerUp} className={styles.block}>
            <h3 id={ids.runnerUp} className={styles.heading}>
              Runner-up
            </h3>
            <RunnerUp summary={summary} />
          </section>

          <section aria-labelledby={ids.risks} className={styles.block}>
            <h3 id={ids.risks} className={styles.heading}>
              Risks to watch
            </h3>
            {summary.risks.length > 0 ? (
              <ul className={styles.risks}>
                {summary.risks.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                No major risks stood out in the modeled ranges.
              </p>
            )}
          </section>
        </div>

        <section
          aria-labelledby={ids.steps}
          className={cn(styles.block, styles.column)}
        >
          <h3 id={ids.steps} className={styles.heading}>
            Next steps
          </h3>
          <NextSteps key={summary.finalizedAt} steps={summary.nextSteps} />
        </section>
      </div>

      <footer className={styles.footer}>
        <Link
          href={exportHref}
          className={cn(styles.primaryAction, focusRing, pressable)}
        >
          Print / export full plan
        </Link>
        <p className={styles.muted}>
          Finalized{" "}
          <time dateTime={summary.finalizedAt} suppressHydrationWarning>
            {formatFinalizedAt(summary.finalizedAt)}
          </time>
        </p>
      </footer>
    </section>
  );
}

function MetricCard({
  label,
  range,
  format,
  signed = false,
}: {
  label: string;
  range: SummaryRange | undefined;
  format: (n: number) => string;
  /** Negative means are tinted (contribution can be a loss). */
  signed?: boolean;
}) {
  return (
    <li className={styles.metric}>
      <h4 className={styles.metricLabel}>{label}</h4>
      {range ? (
        <>
          <p
            className={cn(
              styles.metricValue,
              signed && range.mean < 0 && styles.negative,
            )}
          >
            {format(range.mean)}
          </p>
          <p className={styles.metricRange}>
            <span className="sr-only">Modeled range </span>
            {formatRange(range, format)}
          </p>
          <RangeBar range={range} />
        </>
      ) : (
        <p className={styles.metricValue}>Not modeled</p>
      )}
      <p className={styles.note}>{MODELED_NOTE}</p>
    </li>
  );
}

/** Low-high whisker with the mean marked, on a scale that includes zero. */
function RangeBar({ range }: { range: SummaryRange }) {
  const scale = comparisonScale([range]);
  const low = scale.position(range.low),
    high = scale.position(range.high),
    mean = scale.position(range.mean);
  return (
    <svg
      viewBox="0 0 100 9"
      preserveAspectRatio="none"
      className={styles.rangeBar}
      aria-hidden="true"
    >
      <rect
        x="0"
        y="1"
        width="100"
        height="7"
        rx="1"
        className={styles.track}
      />
      <line
        x1={scale.zero}
        x2={scale.zero}
        y1="0"
        y2="9"
        className={styles.zero}
      />
      <rect
        x={low}
        y="2.5"
        width={Math.max(0.6, high - low)}
        height="4"
        rx=".6"
        className={cn(styles.band, range.mean < 0 && styles.bandNegative)}
      />
      <line x1={mean} x2={mean} y1="1" y2="8" className={styles.mean} />
    </svg>
  );
}

function RunnerUp({ summary }: { summary: FinalPlanSummary }) {
  const gap = runnerUpGap(summary);
  if (!summary.runnerUp || !gap)
    return (
      <p className={styles.muted}>
        No other location was compared in the final run.
      </p>
    );
  const chosen = summary.metrics.monthlyContributionUsd;
  const other = summary.runnerUp.monthlyContributionUsd;
  return (
    <div className={styles.runnerUp}>
      <table className={styles.runnerTable}>
        <caption className="sr-only">
          Modeled operating contribution per month, chosen location versus
          runner-up
        </caption>
        <thead>
          <tr>
            <th scope="col">Location</th>
            <th scope="col">Contribution / mo</th>
            <th scope="col">Range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              {summary.chosenAddress}
              <span className={styles.rowTag}>Chosen</span>
            </th>
            <td>{formatUsd(chosen.mean)}</td>
            <td>{formatRange(chosen, formatUsd)}</td>
          </tr>
          <tr>
            <th scope="row">{summary.runnerUp.address}</th>
            <td>{formatUsd(other.mean)}</td>
            <td>{formatRange(other, formatUsd)}</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.muted}>
        {gap.difference >= 0
          ? `Chosen leads by ${formatUsdDelta(gap.difference)} / month on the modeled mean`
          : `Chosen trails by ${formatUsd(-gap.difference)} / month on the modeled mean`}
        {gap.overlapping
          ? "; the ranges overlap, so the lead is not clear-cut."
          : "."}
      </p>
    </div>
  );
}

function NextSteps({ steps }: { steps: readonly string[] }) {
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set());
  const baseId = useId();
  const toggle = (index: number) =>
    setDone((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <ol className={styles.steps}>
      {steps.map((step, index) => {
        const id = `${baseId}-${index}`;
        return (
          <li
            key={index}
            className={cn(styles.step, done.has(index) && styles.stepDone)}
          >
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <input
              id={id}
              type="checkbox"
              checked={done.has(index)}
              onChange={() => toggle(index)}
              className={cn(styles.checkbox, focusRing)}
            />
            <label htmlFor={id}>{step}</label>
          </li>
        );
      })}
    </ol>
  );
}
