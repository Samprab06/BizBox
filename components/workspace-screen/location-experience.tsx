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
                Rent source: {selected.baseRentCents.origin}
              </p>
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
            className={
              styles.notice +
              " pointer-events-auto flex max-w-fit items-center gap-4"
            }
            role="status"
          >
            <p>
              {controller.phase === "loading"
                ? "Finding spaces…"
                : "No spaces available"}
            </p>
            {controller.phase !== "loading" && (
              <button className={styles.secondary} onClick={controller.retry}>
                Retry
              </button>
            )}
          </div>
        )}

        {view !== "interior" && candidates.length > 0 && (
          <>
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
