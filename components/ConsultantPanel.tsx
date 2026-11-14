"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ConsultantInvestigationResponseSchema,
  selectNessieResults,
  type ConsultantInvestigation as Investigation,
} from "@/components/nessie/consultant-results";
import { ConsultantCashCard } from "@/components/nessie/consultant-cash-card";
import { withoutNessieFindings } from "@/lib/nessie/findings";
import {
  createPanelResendBackoff,
  panelProgressMessage,
  parsePanelProgress,
} from "@/lib/panel/progress";

const POLL_MS = 3000;
const MAX_POLL_BACKOFF_MS = 60_000;
const MAX_POLL_FAILURES = 6;

const TOOL_LABELS: Record<string, string> = {
  save_profile: "Saved the founder profile",
  search_sites: "Searched for-lease spaces",
  get_catchment: "Reviewed a catchment",
  poll_customers: "Polled the customer panel",
  evaluate_sites: "Evaluated the shortlist",
  run_sensitivity: "Ran a sensitivity check",
  get_site_run: "Reviewed a simulated day",
  read_nessie_cash_buffer: "Assessed the simulated cash buffer",
  finish_investigation: "Finished the investigation",
};
const label = (tool: string) => TOOL_LABELS[tool] ?? tool.replaceAll("_", " ");
const STATUS_TEXT: Record<Investigation["job"]["status"], string> = {
  queued: "Queued",
  running: "Working",
  succeeded: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
};

export function ConsultantPanel({
  investigationId,
  projectId,
  profile,
  cashContextStale = false,
}: {
  investigationId?: string;
  projectId: string;
  profile?: { id: string; version: number };
  cashContextStale?: boolean;
}) {
  // Remount on identity change so old findings disappear before the next fetch.
  return (
    <ConsultantActivity
      key={`${projectId}:${investigationId ?? ""}`}
      investigationId={investigationId}
      projectId={projectId}
      profile={profile}
      cashContextStale={cashContextStale}
    />
  );
}

function ConsultantActivity({
  investigationId,
  projectId,
  profile,
  cashContextStale,
}: {
  investigationId?: string;
  projectId: string;
  profile?: { id: string; version: number };
  cashContextStale: boolean;
}) {
  const headingId = useId();
  const [state, setState] = useState<Investigation>();
  const [error, setError] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!investigationId) return;
    const controller = new AbortController();
    const url = `/api/investigations/${encodeURIComponent(investigationId)}`;
    let timer: ReturnType<typeof setTimeout>;
    // Consecutive failures back off (3 s, 6 s, ... 60 s) and stop after MAX_POLL_FAILURES, so a
    // broken job or API can't keep an open tab calling /advance (and the paid model) forever.
    let failures = 0;
    // A 202 from advance is a Jev panel still answering (HAC-155), not an error.
    const panelBackoff = createPanelResendBackoff();
    let panelDelay: number | null = null;
    const poll = async () => {
      panelDelay = null;
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Status unavailable");
        let next = readInvestigation(
          await response.json(),
          investigationId,
          projectId,
        );
        if (controller.signal.aborted) return;
        setState(next);
        setError(false);
        setPollStopped(false);
        failures = 0;
        // Queued jobs start on their first advance; running jobs continue from checkpoints.
        if (next.job.status === "queued" || next.job.status === "running") {
          const advance = await fetch(`${url}/advance`, {
            method: "POST",
            signal: controller.signal,
          });
          if (!advance.ok) throw new Error("Could not advance investigation");
          next = readInvestigation(
            await advance.json(),
            investigationId,
            projectId,
          );
          if (controller.signal.aborted) return;
          setState(next);
          if (next.job.status !== "queued" && next.job.status !== "running")
            return;
          const panel =
            advance.status === 202 ? parsePanelProgress(next.job.reason) : null;
          if (panel) {
            // Resend advance soon while personas keep completing; stop if it stalls.
            panelDelay = panelBackoff.next(panel);
            if (panelDelay === null) {
              setError(true);
              setPollStopped(true);
              return;
            }
          } else panelBackoff.reset();
        } else return;
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setPollStopped(true);
          return;
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(
          poll,
          panelDelay ?? Math.min(POLL_MS * 2 ** failures, MAX_POLL_BACKOFF_MS),
        );
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [investigationId, projectId, attempt]);

  const retry = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!investigationId || !signal || signal.aborted || retrying) return;
    setRetrying(true);
    const url = `/api/investigations/${encodeURIComponent(investigationId)}/advance`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
        signal,
      });
      if (!response.ok) throw new Error("Retry failed");
      const next = readInvestigation(
        await response.json(),
        investigationId,
        projectId,
      );
      if (signal.aborted) return;
      setState(next);
      setError(false);
      setAttempt((n) => n + 1);
    } catch {
      if (!signal.aborted) setError(true);
    } finally {
      if (!signal.aborted) setRetrying(false);
    }
  }, [investigationId, projectId, retrying]);

  const status = state?.job.status;
  const ended = status === "failed" || status === "interrupted";
  // A partial Jev panel is shown as progress, never as a finished step or result.
  const panelProgress =
    status === "queued" || status === "running"
      ? parsePanelProgress(state?.job.reason)
      : null;
  const cashResults =
    investigationId && !retrying
      ? selectNessieResults(state, { investigationId, projectId, profile })
      : { results: [], contextChanged: false };
  const visibleCashResults = cashContextStale
    ? cashResults.results.filter(({ result }) => result.status !== "ready")
    : cashResults.results;
  const findings = state
    ? withoutNessieFindings(state.job.findings, state.milestones)
    : [];
  const hasCashStep = state?.milestones.some(
    (entry) =>
      entry.tool === "read_nessie_cash_buffer" &&
      entry.investigationId === state.job.id &&
      entry.attempt === state.job.attempt,
  );
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-line p-4"
    >
      <h3 id={headingId} className="font-semibold">
        Consultant activity
      </h3>
      <p role="status" className="mt-2 text-sm text-muted">
        {error
          ? pollStopped
            ? "Investigation update unavailable. Reload the page to try again."
            : "Investigation update unavailable. Retrying."
          : panelProgress
            ? panelProgressMessage(panelProgress)
            : status
              ? STATUS_TEXT[status]
              : investigationId
                ? "Loading investigation..."
                : "No investigation linked to this comparison."}
      </p>
      {state && state.milestones.length > 0 && (
        <ol
          aria-label="Investigation steps"
          className="mt-2 list-decimal space-y-1 pl-5 text-sm"
        >
          {[...state.milestones]
            .filter(
              (m) =>
                m.investigationId === state.job.id &&
                m.attempt === state.job.attempt,
            )
            .sort((a, b) => a.seq - b.seq)
            .map((m) => (
              <li key={`${m.attempt}-${m.seq}`}>
                {label(m.tool)}
                {visibleCashResults.find((entry) => entry.seq === m.seq) && (
                  <ConsultantCashCard
                    result={
                      visibleCashResults.find((entry) => entry.seq === m.seq)!
                        .result
                    }
                  />
                )}
              </li>
            ))}
        </ol>
      )}
      {cashContextStale && hasCashStep ? (
        <p className="mt-3 text-sm text-muted">
          Rerun the comparison before using saved cash guidance. Its context is
          outdated or still being evaluated.
        </p>
      ) : (
        cashResults.contextChanged && (
          <p className="mt-3 text-sm text-muted">
            The current business profile differs from this cash assessment. Run
            the consultant again before using its cash guidance.
          </p>
        )
      )}
      {findings.length > 0 && (
        <ul
          aria-label="Findings"
          className="mt-3 list-disc space-y-1 pl-5 text-sm"
        >
          {findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      )}
      {ended && (
        <div className="mt-3">
          <p role="alert" className="text-sm">
            {state?.job.reason ?? "The investigation stopped before finishing."}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="mt-2 rounded bg-pine px-3 py-1.5 text-sm text-white"
          >
            Retry investigation
          </button>
        </div>
      )}
    </section>
  );
}

function readInvestigation(
  raw: unknown,
  investigationId: string,
  projectId: string,
): Investigation {
  const next = ConsultantInvestigationResponseSchema.parse(raw);
  if (next.job.id !== investigationId || next.job.projectId !== projectId)
    throw new Error("Investigation identity changed");
  return next;
}
