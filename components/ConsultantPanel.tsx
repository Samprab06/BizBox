"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

// GET/POST /api/investigations/[id] respond with { job, milestones } (HAC-52/HAC-23).
const investigationResponse = z.object({
  job: z.object({
    status: z.enum(["queued", "running", "succeeded", "failed", "interrupted"]),
    findings: z.array(z.string()).default([]),
    reason: z.string().nullable().optional(),
  }),
  milestones: z.array(
    z.object({
      seq: z.number().int(),
      tool: z.string(),
      attempt: z.number().int().optional(),
    }),
  ),
});
type Investigation = z.infer<typeof investigationResponse>;

const TOOL_LABELS: Record<string, string> = {
  save_profile: "Saved the founder profile",
  search_sites: "Searched for-lease spaces",
  get_catchment: "Reviewed a catchment",
  poll_customers: "Polled the customer panel",
  evaluate_sites: "Evaluated the shortlist",
  run_sensitivity: "Ran a sensitivity check",
  get_site_run: "Reviewed a simulated day",
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
}: {
  investigationId?: string;
}) {
  const [state, setState] = useState<Investigation>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!investigationId) return;
    const controller = new AbortController();
    const url = `/api/investigations/${encodeURIComponent(investigationId)}`;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Status unavailable");
        let next = investigationResponse.parse(await response.json());
        if (controller.signal.aborted) return;
        setState(next);
        setError(false);
        // Queued jobs start on their first advance; running jobs continue from checkpoints.
        if (next.job.status === "queued" || next.job.status === "running") {
          const advance = await fetch(`${url}/advance`, {
            method: "POST",
            signal: controller.signal,
          });
          if (!advance.ok) throw new Error("Could not advance investigation");
          next = investigationResponse.parse(await advance.json());
          if (controller.signal.aborted) return;
          setState(next);
          if (next.job.status !== "queued" && next.job.status !== "running")
            return;
        } else return;
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [investigationId, attempt]);

  const retry = useCallback(async () => {
    if (!investigationId) return;
    const url = `/api/investigations/${encodeURIComponent(investigationId)}/advance`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      if (!response.ok) throw new Error("Retry failed");
      setState(investigationResponse.parse(await response.json()));
      setError(false);
      setAttempt((n) => n + 1);
    } catch {
      setError(true);
    }
  }, [investigationId]);

  const status = state?.job.status;
  const ended = status === "failed" || status === "interrupted";
  return (
    <section
      aria-labelledby="consultant-heading"
      className="rounded-xl border border-line p-4"
    >
      <h3 id="consultant-heading" className="font-semibold">
        Consultant activity
      </h3>
      <p role="status" className="mt-2 text-sm text-muted">
        {error
          ? "Investigation update unavailable. Retrying."
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
            .sort((a, b) => a.seq - b.seq)
            .map((m) => (
              <li key={`${m.attempt ?? 1}-${m.seq}`}>{label(m.tool)}</li>
            ))}
        </ol>
      )}
      {state && state.job.findings.length > 0 && (
        <ul
          aria-label="Findings"
          className="mt-3 list-disc space-y-1 pl-5 text-sm"
        >
          {state.job.findings.map((finding) => (
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
            className="mt-2 rounded bg-pine px-3 py-1.5 text-sm text-white"
          >
            Retry investigation
          </button>
        </div>
      )}
    </section>
  );
}
