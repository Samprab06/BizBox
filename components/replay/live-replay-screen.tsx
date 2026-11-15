"use client";

import Link from "next/link";
import { useWorkspaceReport } from "@/lib/client/use-workspace-context";
import type { WorkspaceObservation } from "@/lib/client/workspace-context";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SiteRunSchema, type SiteRun } from "@/lib/contracts";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { StoredReplayPlayer } from "./stored-replay-player";

type RunState =
  | { kind: "loading" }
  | { kind: "failed"; runId: string }
  | { kind: "ready"; run: SiteRun };
function replayHref(
  projectId: string,
  comparisonId: string,
  siteId: string,
  day: string,
) {
  return `${workspaceHref(projectId, "replay", siteId)}&comparison=${encodeURIComponent(comparisonId)}&day=${day}`;
}

export function LiveReplayScreen({
  project,
  payload,
  siteId,
  dayType = "weekday",
  example,
}: {
  project: PreviewProject;
  payload: LiveComparisonPayload;
  siteId?: string;
  dayType?: "weekday" | "weekend";
  example: ReactNode;
}) {
  const selectedId = siteId ?? payload.result.ranking[0];
  const site = payload.result.sites.find(
    (entry) => entry.siteId === selectedId,
  );
  const representative = site?.representative[dayType];
  const [state, setState] = useState<RunState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const runId = representative?.runId;

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      try {
        const response = await fetch(
          `/api/site-runs/${encodeURIComponent(runId!)}?projectId=${encodeURIComponent(project.id)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Run unavailable");
        const body: unknown = await response.json();
        const parsed = SiteRunSchema.parse(
          typeof body === "object" && body !== null && "run" in body
            ? body.run
            : undefined,
        );
        if (
          parsed.id !== runId ||
          parsed.projectId !== project.id ||
          parsed.profileId !== payload.result.profileId ||
          parsed.siteId !== selectedId ||
          parsed.dayType !== dayType
        )
          throw new Error("Run identity mismatch");
        if (!disposed) setState({ kind: "ready", run: parsed });
      } catch {
        if (!disposed) setState({ kind: "failed", runId: runId! });
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    runId,
    project.id,
    payload.result.profileId,
    selectedId,
    dayType,
    attempt,
  ]);

  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "replay",
      siteId: selectedId,
      phase:
        !site || !representative
          ? "missing"
          : state.kind === "ready" && state.run.id === runId
            ? "ready"
            : state.kind === "failed" && state.runId === runId
              ? "example"
              : "loading",
      synthetic:
        state.kind === "ready" && state.run.id === runId
          ? state.run.synthetic
          : undefined,
    }),
    [selectedId, site, representative, state, runId],
  );
  useWorkspaceReport(project.id, context);

  if (!site || !representative)
    return (
      <div className="space-y-4">
        <p role="status">
          This site has no representative run in the stored comparison. Choose a
          compared site.
        </p>
        <nav aria-label="Replay sites" className="flex flex-wrap gap-4 text-sm">
          {payload.result.sites.map((entry) => (
            <Link
              key={entry.siteId}
              className="underline"
              href={replayHref(
                project.id,
                payload.comparisonId,
                entry.siteId,
                dayType,
              )}
            >
              Site {entry.siteId}
            </Link>
          ))}
        </nav>
      </div>
    );

  // A route/day switch must not briefly play the previous site's stored events.
  const ready = state.kind === "ready" && state.run.id === runId;
  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0 break-words">
        <p className="text-sm text-muted">
          Stored representative simulation · {dayType} · seed{" "}
          {representative.seed}
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Site {site.siteId}</h2>
        <p className="mt-2 text-xs text-muted">
          {payload.comparisonId} · {runId}
        </p>
        {payload.outdated && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm"
          >
            Outdated comparison: this run uses an earlier profile snapshot.
          </p>
        )}
      </div>
      <nav aria-label="Replay sites" className="flex flex-wrap gap-4 text-sm">
        {payload.result.sites.map((entry) => (
          <Link
            key={entry.siteId}
            className="underline aria-[current=page]:font-semibold"
            aria-current={site.siteId === entry.siteId ? "page" : undefined}
            href={replayHref(
              project.id,
              payload.comparisonId,
              entry.siteId,
              dayType,
            )}
          >
            Site {entry.siteId}
          </Link>
        ))}
        <Link
          className="underline"
          href={`${workspaceHref(project.id, "comparison", site.siteId)}&comparison=${encodeURIComponent(payload.comparisonId)}`}
        >
          Back to comparison
        </Link>
      </nav>
      <nav aria-label="Replay day" className="flex flex-wrap gap-3 text-sm">
        {(["weekday", "weekend"] as const).map((day) => (
          <Link
            key={day}
            className="rounded-lg border border-line px-3 py-2 capitalize aria-[current=page]:bg-accent aria-[current=page]:text-on-accent"
            aria-current={day === dayType ? "page" : undefined}
            href={replayHref(
              project.id,
              payload.comparisonId,
              site.siteId,
              day,
            )}
          >
            {day}
          </Link>
        ))}
      </nav>
      {ready ? (
        <StoredReplayPlayer
          key={state.run.id}
          run={state.run}
          representative={representative}
        />
      ) : state.kind === "failed" && state.runId === runId ? (
        <div className="space-y-4">
          <p role="alert">
            The stored run is unavailable. Showing an example replay below.
          </p>
          <button
            type="button"
            className="rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 font-semibold text-on-accent"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Retry stored run
          </button>
          {example}
        </div>
      ) : (
        <p role="status">Loading stored representative run…</p>
      )}
    </div>
  );
}
