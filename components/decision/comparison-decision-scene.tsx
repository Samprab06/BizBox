"use client";

import { useEffect, useState } from "react";
import { SiteRunSchema, type SiteRun } from "@/lib/contracts";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { DecisionReplay } from "./decision-replay";

/** Reads a stored representative; never creates a comparison or paid experiment. */
export function ComparisonDecisionScene({
  projectId,
  payload,
  address,
}: {
  projectId: string;
  payload: LiveComparisonPayload;
  address: (siteId: string) => string;
}) {
  const site = payload.result.sites.find(
    (entry) => entry.siteId === payload.result.ranking[0],
  );
  const runId = site?.representative.weekday.runId;
  const [state, setState] = useState<{ run?: SiteRun; failed?: string }>({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!runId || !site) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let disposed = false;
    async function load() {
      try {
        const response = await fetch(
          `/api/site-runs/${encodeURIComponent(runId!)}?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Run unavailable");
        const body: unknown = await response.json();
        const run = SiteRunSchema.parse(
          typeof body === "object" && body !== null && "run" in body
            ? body.run
            : undefined,
        );
        if (
          run.id !== runId ||
          run.projectId !== projectId ||
          run.siteId !== site!.siteId ||
          run.profileId !== payload.result.profileId ||
          run.dayType !== "weekday"
        )
          throw new Error("Run identity mismatch");
        if (!disposed) setState({ run });
      } catch {
        if (!disposed) setState({ failed: runId });
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
  }, [runId, site, projectId, payload.result.profileId, attempt]);
  if (!site || !runId)
    return <p role="status">No stored representative scene is available.</p>;
  if (state.run?.id === runId)
    return (
      <DecisionReplay
        key={runId}
        run={state.run}
        representative={site.representative.weekday}
        label={`Stored weekday · ${address(site.siteId)}`}
        fullReplayHref={`${workspaceHref(projectId, "replay", site.siteId)}&comparison=${encodeURIComponent(payload.comparisonId)}&day=weekday`}
      />
    );
  return (
    <section
      aria-label="Decision scene"
      className="min-h-40 rounded-lg border border-line p-3 text-sm"
    >
      {state.failed === runId ? (
        <>
          <p role="alert">
            The stored scene is unavailable. The answer above still uses the
            saved comparison.
          </p>
          <button
            type="button"
            className="mt-2 font-semibold text-pine underline"
            onClick={() => {
              setState({});
              retry((value) => value + 1);
            }}
          >
            Retry scene
          </button>
        </>
      ) : (
        <p role="status">Loading recorded scene…</p>
      )}
    </section>
  );
}
