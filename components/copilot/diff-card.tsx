import Link from "next/link";
import { useId } from "react";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  changedPathLabel,
  formatDelta,
  RUN_STATUS_TEXT,
  toolLabel,
  type DiffCard as DiffCardModel,
} from "./controller";

const button =
  "rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60";

const DECISION_TEXT = {
  proposed: "Proposed change",
  kept: "Kept",
  reverting: "Reverting…",
  reverted: "Reverted",
  revert_failed: "Revert failed",
} as const;

/**
 * HAC-84: one agent mutation. Every control is a native button or link, so the card is
 * fully keyboard operable, and the status line is announced politely.
 */
export function DiffCard({
  projectId,
  card,
  active,
  onKeep,
  onRevert,
}: {
  projectId: string;
  card: DiffCardModel;
  active: boolean;
  onKeep: () => void;
  onRevert: () => void;
}) {
  const headingId = useId();
  const { decision } = card;
  const settled = decision.state === "reverted";
  const busy = decision.state === "reverting";
  const title = card.label ?? toolLabel(card.tool);
  return (
    <article
      aria-labelledby={headingId}
      data-testid="copilot-diff-card"
      className="sw-card space-y-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold">
          {title}
        </h4>
        <p role="status" className="text-xs text-muted">
          {DECISION_TEXT[decision.state]}
          {active && " · Active scenario"}
        </p>
      </header>
      {card.rationale && <p className="text-sm">{card.rationale}</p>}
      <div>
        <h5 className="text-xs font-medium text-muted">Scenario diff</h5>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
          {card.changedPaths.map((path) => (
            <li key={path}>{changedPathLabel(path)}</li>
          ))}
          {card.sites.added.length > 0 && (
            <li>Added sites: {card.sites.added.join(", ")}</li>
          )}
          {card.sites.removed.length > 0 && (
            <li>Removed sites: {card.sites.removed.join(", ")}</li>
          )}
          {card.changedPaths.length === 0 &&
            card.sites.added.length === 0 &&
            card.sites.removed.length === 0 && <li>No field changes</li>}
        </ul>
      </div>
      <div>
        <h5 className="text-xs font-medium text-muted">
          Metric deltas · {RUN_STATUS_TEXT[card.run]}
        </h5>
        {card.run === "succeeded" && card.metrics && card.metrics.length > 0 ? (
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
            {card.metrics.map((metric) => (
              <div key={metric.key} className="contents">
                <dt>
                  {metric.label}{" "}
                  <span className="text-xs text-muted">({metric.origin})</span>
                </dt>
                <dd className="text-right tabular-nums">
                  {formatDelta(metric) ?? "Unknown"}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {card.run === "failed"
              ? "The run failed, so there are no results to compare."
              : card.run === "succeeded"
                ? "The run finished without comparable metrics."
                : "Metric deltas appear once this scenario's run finishes."}
          </p>
        )}
      </div>
      {decision.state === "revert_failed" && (
        <p role="alert" className="text-sm text-danger">
          {decision.message}
        </p>
      )}
      {decision.state === "reverted" && (
        <p className="text-sm text-muted">
          Saved as a new revert version ({decision.revertScenarioId}).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          onClick={onKeep}
          disabled={settled || busy || decision.state === "kept"}
          aria-label={`Keep: ${title}`}
        >
          Keep
        </button>
        <button
          type="button"
          className={button}
          onClick={onRevert}
          disabled={settled || busy}
          aria-label={`Revert: ${title}`}
        >
          {decision.state === "revert_failed" ? "Retry revert" : "Revert"}
        </button>
        <Link
          href={workspaceHref(
            projectId,
            "simulator",
            undefined,
            card.comparisonId,
          )}
          prefetch={false}
          className={`${button} inline-block`}
          aria-label={`Open in city view: ${title}`}
        >
          Open in city view
        </Link>
      </div>
    </article>
  );
}
