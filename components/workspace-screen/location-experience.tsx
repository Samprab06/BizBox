"use client";

import { Button } from "@/components/ui/button";

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
import { ComparisonTray, UnitComparison } from "./unit-comparison";
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
  onToggleUnit,
  onEditChoices,
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
  onToggleUnit: (id: string) => void;
  onEditChoices: () => void;
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
  const selectedUnits = selectedIds
    .map((id) => candidates.find((entry) => entry.candidate.id === id)!)
    .filter(Boolean);
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
            <Button variant="glass" onClick={() => setView("locations")}>
              Locations
            </Button>
          )}
          {view === "locations" && markers.length > 0 && onOverview && (
            <Button variant="glass" onClick={onOverview}>
              All locations
            </Button>
          )}
          {candidates.length > 0 && (
            <Button
              variant="glass"
              data-show-location-list
              aria-expanded={listOpen}
              onClick={onShowList}
            >
              Show list ({candidates.length} units)
            </Button>
          )}
        </div>
      </div>

      {view === "results" && (
        <UnitComparison
          units={selectedUnits}
          candidates={candidates}
          controller={controller}
          payload={payload}
          onSelect={select}
          onEdit={onEditChoices}
        />
      )}
      {view === "locations" &&
        candidates.length > 0 &&
        selectedUnits.length === 0 && (
          <div className="pointer-events-auto mx-3 flex items-center justify-between gap-3">
            <span className="text-xs">Comparison 0/2</span>
            <button className={styles.primary} disabled>
              Compare 2 units
            </button>
          </div>
        )}
      <div
        data-map-sheet={
          view !== "locations" || !candidates.length || selectedUnits.length > 0
            ? ""
            : undefined
        }
        className="pointer-events-none relative z-20 mt-auto flex min-h-0 flex-col gap-3 p-3 pb-8 sm:p-4 sm:pb-8"
      >
        {view === "locations" && selectedUnits.length > 0 && (
          <ComparisonTray
            units={selectedUnits}
            candidates={candidates}
            onSelect={select}
            onRemove={onToggleUnit}
            running={running}
            onCompare={() => setView("results")}
          />
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
                <Button
                  variant="glass"
                  className={styles.secondary}
                  onClick={() => setView("locations")}
                >
                  Compare locations first
                </Button>
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
                <Button
                  variant="glass"
                  className={styles.secondary}
                  onClick={controller.retry}
                >
                  Retry
                </Button>
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
