"use client";

import { Button } from "@/components/ui/button";

import dynamic from "next/dynamic";
import Link from "next/link";
import type {
  LiveComparisonController,
  LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import type { SiteTweakMap, SiteTweaks } from "@/lib/contracts/evaluation";
import { MAX_COMPARE_UNITS } from "@/lib/contracts/evaluation";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  candidateMarkers,
  searchPresentation,
  type WorkspaceCandidate,
} from "./client-model";
import { ComparisonTray, ResultsStep, UnitComparison } from "./unit-comparison";
import { TopSites } from "./top-sites";
import { PlanSummary } from "./plan-summary";
import type { WorkspaceStep } from "./workspace-flow";
import styles from "./workspace-glass.module.css";
import { SearchFilterSummary } from "./property-details";

const StationCalloutController = dynamic(
  () =>
    import("@/components/insights/station-callout-controller").then(
      (m) => m.StationCalloutController,
    ),
  { ssr: false },
);

/**
 * The workspace's view for one guided-flow step (Scene 1): `locations` is the map, the top
 * locations and the shortlist tray; `compare` the chosen units and the run; `results` the
 * comparison with its changes; `finalize` the plan summary. The map stays behind them all.
 */
export function LocationExperience({
  projectId,
  controller,
  candidates,
  selected,
  onSelect,
  step,
  interior,
  onInteriorChange,
  onOverview,
  onShowList,
  listOpen,
  onToggleUnit,
  onCompare,
  onEditChoices,
  matching,
  tweaks,
  onRemoveTweak,
  topIds,
  presented,
  onViewResults,
  onRerun,
}: {
  projectId: string;
  controller: LiveComparisonController;
  candidates: WorkspaceCandidate[];
  selected?: WorkspaceCandidate;
  onSelect: (id: string) => void;
  step: WorkspaceStep;
  interior: boolean;
  onInteriorChange: (interior: boolean) => void;
  onOverview?: () => void;
  onShowList?: () => void;
  listOpen?: boolean;
  onToggleUnit: (id: string) => void;
  onCompare: () => void;
  onEditChoices: () => void;
  /** The finished comparison for exactly the selected units and their tweaks. */
  matching: LiveComparisonPayload | null;
  tweaks: SiteTweakMap;
  onRemoveTweak: (candidateId: string, field: keyof SiteTweaks) => void;
  topIds: string[];
  presented: boolean;
  onViewResults: () => void;
  onRerun: () => void;
}) {
  const markers = candidateMarkers(candidates);
  const resultForSite = matching?.result.sites.find(
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
  const locations = step === "locations";
  const map = locations && !interior;

  return (
    <section
      className={styles.viewport}
      aria-label="Location and interior workspace"
      data-map-viewport
      data-agent-anchor="map"
      data-step={step}
    >
      <div className={styles.viewToolbar} data-map-toolbar>
        <div
          className={styles.viewTabs}
          role="group"
          aria-label="Workspace view"
        >
          {locations && interior && (
            <Button variant="glass" onClick={() => onInteriorChange(false)}>
              Locations
            </Button>
          )}
          {map && markers.length > 0 && onOverview && (
            <Button variant="glass" onClick={onOverview}>
              All locations
            </Button>
          )}
          {locations && candidates.length > 0 && (
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

      {step === "compare" && (
        <UnitComparison
          units={selectedUnits}
          candidates={candidates}
          controller={controller}
          payload={matching}
          tweaks={tweaks}
          onSelect={onSelect}
          onEdit={onEditChoices}
          onRemoveTweak={onRemoveTweak}
          onViewResults={onViewResults}
        />
      )}
      {step === "results" && (
        <ResultsStep
          payload={matching}
          units={selectedUnits}
          candidates={candidates}
          tweaks={tweaks}
          loading={controller.phase === "loading"}
          running={running}
          onSelect={onSelect}
          onChangeSite={onEditChoices}
          onRerun={onRerun}
          onRemoveTweak={onRemoveTweak}
        />
      )}
      {step === "finalize" && (
        <div className={styles.unitComparison}>
          <PlanSummary projectId={projectId} />
        </div>
      )}
      {map && candidates.length > 0 && selectedUnits.length === 0 && (
        <div className="pointer-events-auto mx-3 flex items-center justify-between gap-3">
          <span className="text-xs">Comparison 0/{MAX_COMPARE_UNITS}</span>
          <button className={styles.primary} disabled>
            Compare 2 units
          </button>
        </div>
      )}
      <div
        data-map-sheet={
          !map || !candidates.length || selectedUnits.length > 0
            ? ""
            : undefined
        }
        className="pointer-events-none relative z-20 mt-auto flex min-h-0 flex-col gap-3 p-3 pb-8 sm:p-4 sm:pb-8"
      >
        {map && topIds.length > 0 && (
          <TopSites
            ids={topIds}
            candidates={candidates}
            selectedIds={selectedIds}
            presented={presented}
            running={running}
            onSelect={onSelect}
            onToggle={onToggleUnit}
          />
        )}
        {map && selectedUnits.length > 0 && (
          <ComparisonTray
            units={selectedUnits}
            candidates={candidates}
            onSelect={onSelect}
            onRemove={onToggleUnit}
            running={running}
            onCompare={onCompare}
          />
        )}
        {locations && interior && selected && (
          <details
            className={
              styles.details +
              " pointer-events-auto max-h-[400px] max-w-xl overflow-y-auto"
            }
          >
            <summary className="cursor-pointer text-sm font-medium">
              Test capacity
            </summary>
            {matching && resultForSite ? (
              <div className="mt-4">
                <StationCalloutController
                  projectId={projectId}
                  comparisonId={matching.comparisonId}
                  siteId={selected.candidate.id}
                  profileId={matching.result.profileId}
                  profileVersion={matching.result.profileVersion}
                  seeds={matching.result.seeds}
                  synthetic={false}
                  modelVersion={matching.result.modelVersion}
                  founderLabels
                />
              </div>
            ) : (
              <div className="mt-3">
                <Button
                  variant="glass"
                  className={styles.secondary}
                  onClick={() => onInteriorChange(false)}
                >
                  Compare locations first
                </Button>
              </div>
            )}
          </details>
        )}

        {locations && !interior && !candidates.length && (
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
