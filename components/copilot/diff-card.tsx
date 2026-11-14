import Link from "next/link";
import { useId } from "react";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  cardActions,
  changedPathLabel,
  RUN_STATUS_TEXT,
  type CardAction,
  type DiffCard as DiffCardModel,
} from "./controller";

const button =
  "rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_TEXT: Record<DiffCardModel["status"], string> = {
  pending: "Proposed change",
  run_requested: "Run requested",
  kept: "Kept",
  reverted: "Reverted",
};
const PENDING_TEXT: Record<CardAction, string> = {
  run: "Requesting run…",
  keep: "Keeping…",
  revert: "Reverting…",
};
const ACTION_TEXT: Record<CardAction, string> = {
  run: "Run",
  keep: "Keep",
  revert: "Revert",
};

/**
 * HAC-84: one agent mutation. Every control is a native button or link, so the card is
 * fully keyboard operable, and its status line is announced politely.
 */
export function DiffCard({
  projectId,
  card,
  active,
  onAction,
  onRetryRevertVersion,
}: {
  projectId: string;
  card: DiffCardModel;
  active: boolean;
  onAction: (action: CardAction) => void;
  onRetryRevertVersion: () => void;
}) {
  const headingId = useId();
  const available = cardActions(card);
  const busy = card.pending !== null;
  const noDiff =
    card.changedPaths.length === 0 &&
    card.sites.added.length === 0 &&
    card.sites.removed.length === 0;
  return (
    <article
      aria-labelledby={headingId}
      data-testid="copilot-diff-card"
      className="sw-card space-y-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold">
          {card.title}
        </h4>
        <p role="status" className="text-xs text-muted">
          {card.pending ? PENDING_TEXT[card.pending] : STATUS_TEXT[card.status]}
          {active && " · Active scenario"}
        </p>
      </header>
      <p className="text-sm">{card.description}</p>
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
          {noDiff && <li>No field-level diff was reported</li>}
        </ul>
      </div>
      <div>
        <h5 className="text-xs font-medium text-muted">
          Metric deltas · {RUN_STATUS_TEXT[card.run]}
        </h5>
        <p className="mt-1 text-sm text-muted">
          {card.run === "succeeded" && card.comparisonId ? (
            <Link
              href={`${workspaceHref(projectId, "comparison")}?comparison=${encodeURIComponent(card.comparisonId)}`}
              prefetch={false}
              className="text-pine underline underline-offset-4"
            >
              Compare against the current setup
            </Link>
          ) : card.run === "failed" ? (
            "The run failed, so there are no results to compare."
          ) : card.run === "succeeded" ? (
            "The run finished without a saved comparison."
          ) : (
            "Metric deltas appear once you run this change and it finishes."
          )}
        </p>
      </div>
      {card.error && (
        <p role="alert" className="text-sm text-danger">
          {card.error}
        </p>
      )}
      {card.revertScenarioId && (
        <p className="text-sm text-muted">
          Saved as a new revert version ({card.revertScenarioId}).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(["run", "keep", "revert"] as const).map((action) =>
          action === "run" && !available.includes("run") ? null : (
            <button
              key={action}
              type="button"
              className={button}
              onClick={() => onAction(action)}
              disabled={busy || !available.includes(action)}
              aria-label={`${ACTION_TEXT[action]}: ${card.title}`}
            >
              {ACTION_TEXT[action]}
            </button>
          ),
        )}
        {card.revertVersionFailed && (
          <button
            type="button"
            className={button}
            onClick={onRetryRevertVersion}
          >
            Retry saving the revert version
          </button>
        )}
        <Link
          href={workspaceHref(
            projectId,
            "simulator",
            undefined,
            card.comparisonId,
          )}
          prefetch={false}
          className={`${button} inline-block`}
          aria-label={`Open in city view: ${card.title}`}
        >
          Open in city view
        </Link>
      </div>
    </article>
  );
}
