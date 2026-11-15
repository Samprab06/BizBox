"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWorkspaceReport } from "@/lib/client/use-workspace-context";
import type { WorkspaceObservation } from "@/lib/client/workspace-context";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { InsightsPanel } from "./insights-panel";
import { insightsReference, parseStoredInsights } from "./stored-insights";
import { StationCalloutController } from "./station-callout-controller";

type State =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string; failed?: boolean }
  | { kind: "ready"; value: ReturnType<typeof parseStoredInsights> };

/** GET-only: opening Insights never runs or backfills an evaluation. */
export function InsightsWorkspace({
  projectId,
  siteId,
}: {
  projectId: string;
  siteId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  const search = useSearchParams().toString();
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      setState({ kind: "loading" });
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(`sitework:comparison:v1:${projectId}`);
      } catch {
        // Explicit comparison links still work when browser storage is blocked.
      }
      const selection = insightsReference(
        window.location.href,
        saved,
        projectId,
      );
      if (!selection.comparisonId) {
        clearTimeout(timeout);
        setState({
          kind: "unavailable",
          reason: "Select a saved comparison to view this site's insights.",
        });
        return;
      }
      try {
        const query = new URLSearchParams({ projectId });
        const response = await fetch(
          `/api/comparisons/${encodeURIComponent(selection.comparisonId)}?${query}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("Saved comparison could not be loaded.");
        const value = parseStoredInsights(await response.json(), {
          ...selection,
          comparisonId: selection.comparisonId,
          projectId,
          siteId,
        });
        if (!disposed) setState({ kind: "ready", value });
      } catch {
        if (!disposed)
          setState({
            kind: "unavailable",
            reason:
              "Saved insights could not be verified for this project, site and profile. Retry or choose another comparison.",
            failed: true,
          });
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
  }, [projectId, siteId, attempt, search]);

  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "stored",
      phase:
        state.kind === "ready"
          ? "ready"
          : state.kind === "loading"
            ? "loading"
            : "example",
      comparisonId:
        state.kind === "ready" ? state.value.payload.comparisonId : undefined,
      synthetic:
        state.kind === "ready"
          ? state.value.payload.comparison?.synthetic
          : undefined,
      outdated:
        state.kind === "ready" ? state.value.payload.outdated : undefined,
      siteIds: state.kind === "ready" ? [siteId] : [],
      candidates: [],
    }),
    [state, siteId],
  );
  useWorkspaceReport(projectId, context);

  const data = state.kind === "ready" ? state.value.site.insights : undefined;
  return (
    <div className="mt-8 min-w-0">
      {state.kind === "ready" && state.value.payload.outdated && (
        <p
          role="status"
          className="mb-3 text-sm text-[var(--sw-assumption-ink)]"
        >
          Saved scenario is outdated. These insights retain its original profile
          and assumptions.
        </p>
      )}
      {data && state.kind === "ready" ? (
        <InsightsPanel
          data={data}
          sourceLabel={`Saved comparison · profile ${state.value.payload.result.profileId} v${state.value.payload.result.profileVersion}`}
          stationSlot={
            <StationCalloutController
              key={state.value.payload.comparisonId}
              projectId={projectId}
              comparisonId={state.value.payload.comparisonId}
              siteId={siteId}
              profileId={state.value.payload.result.profileId}
              profileVersion={state.value.payload.result.profileVersion}
              seeds={state.value.payload.result.seeds}
              synthetic={data.synthetic}
              modelVersion={state.value.payload.result.modelVersion}
            />
          }
        />
      ) : (
        <Card
          role="region"
          aria-label="Insights"
          className="rounded-card border border-line p-5"
        >
          <h3 className="text-xl font-semibold">Insights</h3>
          <p
            role={
              state.kind === "unavailable" && state.failed ? "alert" : "status"
            }
            className="mt-2 text-sm text-muted"
          >
            {state.kind === "loading"
              ? "Loading saved insights…"
              : state.kind === "unavailable"
                ? state.reason
                : "This saved comparison has no retained cross-seed insights. Representative replay data cannot supply honest seed bands."}
          </p>
          {state.kind === "unavailable" && state.failed && (
            <Button
              variant="primary"
              type="button"
              className="mt-3 rounded bg-accent px-3 py-2 text-on-accent"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry insights
            </Button>
          )}
        </Card>
      )}
      {!data && state.kind === "ready" && (
        <Card className="mt-4 rounded-card border border-line p-4">
          <StationCalloutController
            key={state.value.payload.comparisonId}
            projectId={projectId}
            comparisonId={state.value.payload.comparisonId}
            siteId={siteId}
            profileId={state.value.payload.result.profileId}
            profileVersion={state.value.payload.result.profileVersion}
            seeds={state.value.payload.result.seeds}
            synthetic={state.value.payload.comparison?.synthetic}
            modelVersion={state.value.payload.result.modelVersion}
          />
        </Card>
      )}
      <Link
        className="mt-3 inline-block text-sm text-accent underline"
        href={
          workspaceHref(projectId, "comparison", siteId) +
          (state.kind === "ready"
            ? `&comparison=${encodeURIComponent(state.value.payload.comparisonId)}`
            : "")
        }
      >
        Review comparisons
      </Link>
    </div>
  );
}
