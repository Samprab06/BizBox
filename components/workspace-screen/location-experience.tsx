"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { LiveComparisonController } from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  comparisonMatchesSelection,
  candidateMarkers,
  searchPresentation,
  type WorkspaceCandidate,
} from "./client-model";
import { LocationResults } from "./location-results";
import styles from "./workspace-glass.module.css";
import { SearchFilterSummary } from "./property-details";

const StationCalloutController = dynamic(
  () =>
    import("@/components/insights/station-callout-controller").then(
      (m) => m.StationCalloutController,
    ),
  { ssr: false },
);

export function LocationExperience({
  projectId,
  controller,
  candidates,
  selected,
  onSelect,
  view,
  onViewChange: setView,
  onOverview,
  onShowList,
  listOpen,
}: {
  projectId: string;
  controller: LiveComparisonController;
  candidates: WorkspaceCandidate[];
  selected?: WorkspaceCandidate;
  onSelect: (id: string) => void;
  view: "locations" | "interior" | "results";
  onViewChange: (view: "locations" | "interior" | "results") => void;
  onOverview?: () => void;
  onShowList?: () => void;
  listOpen?: boolean;
}) {
  const markers = candidateMarkers(candidates);
  const payload =
    controller.phase === "ready" &&
    comparisonMatchesSelection(controller.payload, controller.selectedIds)
      ? controller.payload
      : null;
  const resultForSite = payload?.result.sites.find(
    (entry) => entry.siteId === selected?.candidate.id,
  );
  const running = controller.phase === "running";
  const search = controller.search;
  const searchUi = searchPresentation(search, controller.phase === "loading");
  const selectedIds = controller.selectedIds.filter((id) =>
    candidates.some((entry) => entry.candidate.id === id),
  );
  const canCompare =
    !running && controller.phase !== "loading" && selectedIds.length >= 2;
  function select(id: string) {
    onSelect(id);
  }

  return (
    <section
      className={styles.viewport}
      aria-label="Location and interior workspace"
      data-map-viewport
    >
      <div className={styles.viewToolbar} data-map-toolbar>
        <div
          className={styles.viewTabs}
          role="group"
          aria-label="Workspace view"
        >
          {view !== "locations" && (
            <button onClick={() => setView("locations")}>Locations</button>
          )}
          {view === "locations" && markers.length > 0 && onOverview && (
            <button onClick={onOverview}>All locations</button>
          )}
          {candidates.length > 0 && (
            <button
              data-show-location-list
              aria-expanded={listOpen}
              onClick={onShowList}
            >
              Show list ({candidates.length} spaces)
            </button>
          )}
        </div>
        <details className={styles.moreActions}>
          <summary>More</summary>
          <div>
            <button
              aria-pressed={view === "interior"}
              disabled={!selected}
              onClick={() => setView("interior")}
            >
              Interior
            </button>
            {payload && (
              <button
                aria-pressed={view === "results"}
                onClick={() => setView("results")}
              >
                Results
              </button>
            )}
            <button
              className={styles.primary}
              disabled={!canCompare}
              onClick={() => {
                setView("results");
                void controller.run();
              }}
            >
              {running ? "Comparing…" : "Compare locations"}
            </button>
          </div>
        </details>
      </div>

      <div
        data-map-sheet={
          view !== "locations" || !candidates.length ? "" : undefined
        }
        className="pointer-events-none relative z-20 mt-auto flex min-h-0 flex-col gap-3 p-3 pb-8 sm:p-4 sm:pb-8"
      >
        {view === "results" && (
          <div className="pointer-events-auto max-h-[430px] overflow-y-auto">
            {running ? (
              <div className={styles.notice} role="status">
                Comparing locations…
              </div>
            ) : payload ? (
              <LocationResults
                payload={payload}
                candidates={candidates}
                onSelect={(id) => {
                  select(id);
                  setView("locations");
                }}
              />
            ) : (
              <div className={styles.notice} role="status">
                {controller.phase === "example"
                  ? "Comparison unavailable. Try again."
                  : "Select two locations to compare."}
              </div>
            )}
          </div>
        )}

        {view === "interior" && selected && (
          <details
            className={
              styles.details +
              " pointer-events-auto max-h-[400px] max-w-xl overflow-y-auto"
            }
          >
            <summary className="cursor-pointer text-sm font-medium">
              Test capacity
            </summary>
            {payload && resultForSite ? (
              <div className="mt-4">
                <StationCalloutController
                  projectId={projectId}
                  comparisonId={payload.comparisonId}
                  siteId={selected.candidate.id}
                  profileId={payload.result.profileId}
                  profileVersion={payload.result.profileVersion}
                  seeds={payload.result.seeds}
                  synthetic={false}
                  modelVersion={payload.result.modelVersion}
                  founderLabels
                />
              </div>
            ) : (
              <div className="mt-3">
                <button
                  className={styles.secondary}
                  onClick={() => setView("locations")}
                >
                  Compare locations first
                </button>
              </div>
            )}
          </details>
        )}

        {view !== "interior" && !candidates.length && (
          <div
            className={styles.notice + " pointer-events-auto max-w-fit"}
            role="status"
          >
            <div className="flex flex-wrap items-center gap-4">
              <p>{searchUi.label}</p>
              {searchUi.action === "retry" && (
                <button className={styles.secondary} onClick={controller.retry}>
                  Retry
                </button>
              )}
              {searchUi.action === "finish_brief" && (
                <Link
                  className={styles.secondary}
                  href={workspaceHref(projectId, "intake")}
                >
                  Finish brief
                </Link>
              )}
              {searchUi.action === "revise" && (
                <Link
                  className={styles.secondary}
                  href={workspaceHref(projectId, "intake")}
                >
                  Revise criteria
                </Link>
              )}
              {search && search.status !== "loading" && (
                <details className="text-xs">
                  <summary className="cursor-pointer">Details</summary>
                  <SearchFilterSummary search={search} />
                </details>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
