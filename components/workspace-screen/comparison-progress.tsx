"use client";

import { useEffect, useState } from "react";
import type { ComparisonRun } from "@/lib/client/live-comparison";
import type { PanelProgressCount } from "@/lib/panel/progress";
import { unitAddress, type WorkspaceCandidate } from "./client-model";
import { elapsedText, progressStages } from "./workspace-flow";
import styles from "./workspace-glass.module.css";

/**
 * Scene 1: what a running comparison is doing. The Jev customer panel reports personas
 * answered (HAC-155's 202 replies); the simulation and the economics run on the server in
 * the same request, so they show as in progress or waiting rather than as invented numbers.
 */
export function ComparisonProgress({
  run,
  progress,
  candidates,
}: {
  run: ComparisonRun;
  progress: PanelProgressCount | null;
  candidates: readonly WorkspaceCandidate[];
}) {
  const now = useNow(1000);
  const stages = progressStages(run.demandSource, progress);
  const current =
    stages.find((stage) => stage.status === "active") ?? stages[stages.length - 1];
  const jev = run.demandSource === "jev";
  const units = run.siteIds.map((id) => {
    const entry = candidates.find((candidate) => candidate.candidate.id === id);
    return { id, label: entry ? unitAddress(entry, candidates) : "Saved unit" };
  });
  return (
    <section
      className={styles.progressPanel}
      aria-label="Comparison progress"
      data-agent-anchor="comparison_table"
    >
      <div className={styles.progressHeading}>
        <h3>Running your comparison</h3>
        <span className="text-xs tabular-nums">
          Elapsed {elapsedText(now - run.startedAt)}
        </span>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-sm">
        {current.label}: {current.detail}
      </p>
      <div className={styles.progressMeta}>
        <span className={styles.badge}>
          Demand: {jev ? "Jev customer panel" : "Huff model"}
        </span>
        {units.map((unit, index) => (
          <span key={unit.id} className={styles.badge}>
            {index + 1}. {unit.label}
          </span>
        ))}
      </div>
      <ol className={styles.stages}>
        {stages.map((stage, index) => (
          <li key={stage.id} className={styles.stage} data-status={stage.status}>
            <span className={styles.stageMarker} aria-hidden="true">
              {stage.status === "done" ? "✓" : stage.status === "skipped" ? "–" : index + 1}
            </span>
            <div className="min-w-0">
              <strong>
                {stage.label}
                <span className="sr-only">
                  {" "}
                  ({statusText[stage.status]})
                </span>
                {stage.status === "skipped" && (
                  <span className="ml-2 text-[11px] font-normal" aria-hidden="true">
                    n/a
                  </span>
                )}
              </strong>
              <p>{stage.detail}</p>
              {stage.id === "panel" && stage.status !== "skipped" && (
                <div
                  className={styles.stageBar}
                  role="progressbar"
                  aria-label="Jev personas answered"
                  aria-valuemin={0}
                  aria-valuemax={progress?.totalPersonas || 100}
                  aria-valuenow={progress?.completedPersonas ?? 0}
                >
                  <span
                    style={{ width: `${Math.round((stage.fraction ?? 0) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs opacity-75">
        {jev
          ? "Jev runs can take a few minutes while every persona answers. You can keep talking with the assistant meanwhile."
          : "Huff runs usually finish in a few seconds."}{" "}
        Modeled estimates; no measured foot traffic.
      </p>
    </section>
  );
}

const statusText = {
  pending: "waiting",
  active: "in progress",
  done: "done",
  skipped: "not used",
} as const;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
