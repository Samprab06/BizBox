"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type { LiveComparisonController } from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  comparisonMatchesSelection,
  candidateFitReasons,
  candidateMarkers,
  searchFilterLabel,
  searchPresentation,
  type WorkspaceCandidate,
} from "./client-model";
import { metricText } from "./model";
import { LocationResults } from "./location-results";
import styles from "./workspace-glass.module.css";
import type { SiteSearchReadiness } from "@/lib/client/use-site-search";

const StationCalloutController = dynamic(
  () =>
    import("@/components/insights/station-callout-controller").then(
      (m) => m.StationCalloutController,
    ),
  { ssr: false },
);

function SearchFilterSummary({ search }: { search: SiteSearchReadiness }) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      {search.status === "empty" || search.status === "ready" ? (
        <>
          {search.emptyReason && <p>{search.emptyReason}</p>}
          <p>
            {search.totalMatched.toLocaleString("en-US")} listings matched the
            saved filters.
          </p>
          <ul className="space-y-1">
            {search.filters.map((filter) => (
              <li key={filter.name}>
                {searchFilterLabel(filter.name)}:{" "}
                {filter.before.toLocaleString("en-US")} →{" "}
                {filter.after.toLocaleString("en-US")}
              </li>
            ))}
          </ul>
          {search.mostRestrictiveFilter && (
            <p>
              Largest reduction:{" "}
              {searchFilterLabel(search.mostRestrictiveFilter)}
            </p>
          )}
          {search.notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </>
      ) : (
        <p>{search.message}</p>
      )}
    </div>
  );
}

export function LocationExperience({
  projectId,
  controller,
  candidates,
  selected,
  onSelect,
  view,
  onViewChange: setView,
  onOverview,
}: {
  projectId: string;
  controller: LiveComparisonController;
  candidates: WorkspaceCandidate[];
  selected?: WorkspaceCandidate;
  onSelect: (id: string) => void;
  view: "locations" | "interior" | "results";
  onViewChange: (view: "locations" | "interior" | "results") => void;
  onOverview?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const markers = candidateMarkers(candidates);
  const missingCoordinates =
    candidates.length -
    markers.reduce((count, marker) => count + marker.members.length, 0);
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
  const searchProfile =
    search?.status === "ready" || search?.status === "empty"
      ? search.profile
      : undefined;
  const selectedFit = selected
    ? candidateFitReasons(selected, searchProfile)
    : [];
  const selectedIds = controller.selectedIds.filter((id) =>
    candidates.some((entry) => entry.candidate.id === id),
  );
  const canCompare =
    !running && controller.phase !== "loading" && selectedIds.length >= 2;
  function select(id: string) {
    onSelect(id);
    setExpanded(false);
  }
  function compareId(id: string, checked: boolean) {
    controller.setSelectedIds(
      checked
        ? [...new Set([...selectedIds, id])]
        : selectedIds.filter((value) => value !== id),
    );
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
          <button
            aria-pressed={view === "locations"}
            onClick={() => setView("locations")}
          >
            Locations
          </button>
          {view === "locations" && markers.length > 0 && onOverview && (
            <button onClick={onOverview}>All locations</button>
          )}
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
        </div>
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

      <div
        data-map-sheet
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

        {view === "locations" && selected && (
          <section
            className={styles.details + " pointer-events-auto max-w-lg"}
            aria-label="Selected location"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2>{selected.candidate.address}</h2>
                {selectedFit.length > 0 && (
                  <p className={styles.muted + " mt-2 text-xs"}>
                    {selectedFit.join(" · ")}
                  </p>
                )}
              </div>
              <button
                className={styles.secondary}
                aria-expanded={expanded}
                aria-controls="workspace-listing-details"
                onClick={() => setExpanded((value) => !value)}
              >
                Details
              </button>
            </div>
            <dl>
              <div>
                <dt>Rent / month</dt>
                <dd>{metricText(selected.baseRentCents)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{metricText(selected.candidate.floorAreaSqFt)} sq ft</dd>
              </div>
            </dl>
            <button
              className={styles.primary}
              onClick={() => setView("interior")}
            >
              View interior
            </button>
            <div
              id="workspace-listing-details"
              hidden={!expanded}
              className="mt-3 text-xs"
            >
              <p>{selected.candidate.name}</p>
              <p className="mt-2">
                Property-level listing coordinates; 3D imagery coverage varies.
              </p>
              {missingCoordinates > 0 && (
                <p className="mt-2">
                  {missingCoordinates}{" "}
                  {missingCoordinates === 1 ? "space has" : "spaces have"} no
                  mapped coordinates.
                </p>
              )}
              <p className="mt-2">
                Rent source: {selected.baseRentCents.origin}
              </p>
              {search && <SearchFilterSummary search={search} />}
              {selected.flags.length > 0 && (
                <p className="mt-2">{selected.flags.join(" · ")}</p>
              )}
              <Link
                className="mt-2 inline-block underline"
                href={workspaceHref(projectId, "site", selected.candidate.id)}
              >
                Full details
              </Link>
            </div>
          </section>
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

        {view !== "interior" && candidates.length > 0 && (
          <>
            <div
              className={styles.candidates + " pointer-events-auto"}
              role="group"
              aria-label="Matching locations"
            >
              {candidates.map((entry) => {
                const marker = markers.find((group) =>
                  group.members.some(
                    (member) => member.siteId === entry.candidate.id,
                  ),
                );
                const unit = marker
                  ? marker.members.findIndex(
                      (member) => member.siteId === entry.candidate.id,
                    ) + 1
                  : 0;
                return (
                  <div
                    className={
                      styles.candidate +
                      (entry.candidate.id === selected?.candidate.id
                        ? " " + styles.selectedCandidate
                        : "")
                    }
                    key={entry.candidate.id}
                  >
                    <button
                      className="text-left"
                      aria-pressed={
                        entry.candidate.id === selected?.candidate.id
                      }
                      aria-label={"View " + entry.candidate.address}
                      onClick={() => select(entry.candidate.id)}
                    >
                      <strong className="block">
                        {entry.candidate.address}
                      </strong>
                    </button>
                    <span className={styles.muted}>
                      {marker
                        ? `Map ${marker.index}${marker.members.length > 1 ? ` · Space ${unit} of ${marker.members.length}` : ""}`
                        : "Coordinates unavailable"}
                    </span>
                    <span className="block">
                      {entry.baseRentCents.value === null
                        ? "Rent unknown"
                        : metricText(entry.baseRentCents) + "/mo"}
                    </span>
                    {entry.candidate.floorAreaSqFt.value !== null && (
                      <span>
                        {metricText(entry.candidate.floorAreaSqFt)} sq ft
                      </span>
                    )}
                    {candidateFitReasons(entry, searchProfile).length > 0 && (
                      <span className={styles.muted}>
                        {candidateFitReasons(entry, searchProfile).join(" · ")}
                      </span>
                    )}
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={"Compare " + entry.candidate.address}
                        checked={selectedIds.includes(entry.candidate.id)}
                        disabled={running}
                        onChange={(event) =>
                          compareId(entry.candidate.id, event.target.checked)
                        }
                      />
                      Compare
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
