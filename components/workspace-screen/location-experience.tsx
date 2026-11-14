"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import type { LiveComparisonController } from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  comparisonMatchesSelection,
  type WorkspaceCandidate,
} from "./client-model";
import { metricText } from "./model";
import { LocationResults } from "./location-results";
import styles from "./workspace-glass.module.css";

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
}: {
  projectId: string;
  controller: LiveComparisonController;
  candidates: WorkspaceCandidate[];
  selected?: WorkspaceCandidate;
  onSelect: (id: string) => void;
  view: "locations" | "interior" | "results";
  onViewChange: (view: "locations" | "interior" | "results") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const payload =
    controller.phase === "ready" &&
    comparisonMatchesSelection(controller.payload, controller.selectedIds)
      ? controller.payload
      : null;
  const resultForSite = payload?.result.sites.find(
    (entry) => entry.siteId === selected?.candidate.id,
  );
  const running = controller.phase === "running";
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
    >
      <div className={styles.viewToolbar}>
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

      <div className="pointer-events-none relative z-20 mt-auto flex min-h-0 flex-col gap-3 p-3 pb-8 sm:p-4 sm:pb-8">
        {view === "results" && (
          <div className="pointer-events-auto max-h-[430px] overflow-y-auto">
            {running ? (
              <div className={styles.notice} role="status">
                Comparing {selectedIds.length} locations using your business
                brief. Results appear here when ready; no replay is required.
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
                  ? "We couldn’t verify the comparison. Retry when the service is available."
                  : "Select at least two locations, then compare them."}
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
                <span className={styles.badge}>Matched listing</span>
                <h2 className="mt-2">{selected.candidate.address}</h2>
                <p className={styles.muted}>{selected.candidate.city}</p>
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
                <dt>Monthly base rent</dt>
                <dd>
                  {metricText(selected.baseRentCents)}{" "}
                  <span className="text-xs opacity-70">
                    {selected.baseRentCents.origin}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Listing area</dt>
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
              {selected.flags.length > 0 && (
                <p className="mt-2">{selected.flags.join(" · ")}</p>
              )}
              <Link
                className="mt-2 inline-block underline"
                href={workspaceHref(projectId, "site", selected.candidate.id)}
              >
                Listing details and evidence
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
              Indoor experiment · Test service capacity
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
                <p className="text-sm">
                  Compare locations first to save the current setup for this
                  space.
                </p>
                <button
                  className={styles.secondary + " mt-3"}
                  onClick={() => setView("locations")}
                >
                  Choose locations
                </button>
              </div>
            )}
          </details>
        )}

        {view !== "interior" && !candidates.length && (
          <div className={styles.notice + " pointer-events-auto"} role="status">
            <p>
              {controller.phase === "loading"
                ? "Finding matching spaces…"
                : "No verified spaces are available for this brief right now."}
            </p>
            {controller.phase !== "loading" && (
              <div className={styles.toolbarActions + " mt-3"}>
                <button className={styles.secondary} onClick={controller.retry}>
                  Retry listings
                </button>
                <Link
                  className={styles.secondary}
                  href={workspaceHref(projectId, "intake")}
                >
                  Review brief
                </Link>
              </div>
            )}
          </div>
        )}

        {view !== "interior" && candidates.length > 0 && (
          <>
            <p className="rounded-lg bg-black/40 px-3 py-1 text-xs">
              {selectedIds.length} selected for comparison · Estimates are
              modeled, not observed foot traffic
            </p>
            <div
              className={styles.candidates + " pointer-events-auto"}
              role="group"
              aria-label="Matching locations"
            >
              {candidates.map((entry) => (
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
                    aria-pressed={entry.candidate.id === selected?.candidate.id}
                    aria-label={"View " + entry.candidate.address}
                    onClick={() => select(entry.candidate.id)}
                  >
                    <strong className="block">{entry.candidate.address}</strong>
                  </button>
                  <span className="block">
                    {entry.baseRentCents.value === null
                      ? "Rent unknown"
                      : metricText(entry.baseRentCents) + "/mo"}
                  </span>
                  <span className={styles.muted}>{entry.candidate.city}</span>
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
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
