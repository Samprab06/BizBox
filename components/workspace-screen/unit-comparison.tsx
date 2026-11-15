"use client";
import { Glass } from "@/components/ui/glass";
import type {
  LiveComparisonController,
  LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import {
  MAX_COMPARE_UNITS,
  type SiteTweakMap,
  type SiteTweaks,
} from "@/lib/contracts/evaluation";
import {
  areaText,
  comparisonStaleness,
  finishedComparison,
  listingNotes,
  rentText,
  staleMessage,
  unitAddress,
  type Staleness,
  type WorkspaceCandidate,
} from "./client-model";
import { LocationResults } from "./location-results";
import { ComparisonProgress } from "./comparison-progress";
import { SiteTweakChips } from "./site-tweaks";
import dynamic from "next/dynamic";
import { useId, useState } from "react";
import styles from "./workspace-glass.module.css";

const StationCalloutController = dynamic(
  () =>
    import("@/components/insights/station-callout-controller").then(
      (m) => m.StationCalloutController,
    ),
  { ssr: false },
);

const MIN_COMPARE_UNITS = 2;
const compareLabel = (count: number) =>
  `Compare ${Math.max(MIN_COMPARE_UNITS, count)} units`;
const unitsWord = (count: number) =>
  count === 3 ? "three" : count === 2 ? "two" : String(count);

export function ComparisonTray({
  units,
  candidates,
  onSelect,
  onRemove,
  onCompare,
  running,
}: {
  units: WorkspaceCandidate[];
  candidates: WorkspaceCandidate[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onCompare: () => void;
  running: boolean;
}) {
  const ready =
    units.length >= MIN_COMPARE_UNITS && units.length <= MAX_COMPARE_UNITS;
  return (
    <Glass
      role="region"
      className={styles.shortlist}
      aria-label="Comparison shortlist"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm">
          Comparison {units.length}/{MAX_COMPARE_UNITS}
        </h2>
        <button
          className={styles.primary}
          disabled={!ready || running}
          onClick={onCompare}
        >
          {compareLabel(units.length)}
        </button>
      </div>
      <div className={styles.shortlistUnits} data-count={units.length}>
        {units.map((unit) => (
          <div key={unit.candidate.id} className={styles.shortlistUnit}>
            <button
              className="min-w-0 text-left"
              onClick={() => onSelect(unit.candidate.id)}
            >
              <strong className="block text-xs">
                {unitAddress(unit, candidates)}
              </strong>
              <span className="mt-1 block text-xs opacity-75">
                {rentText(unit)} · {areaText(unit)}
              </span>
            </button>
            <button
              className={styles.secondary}
              aria-label={`Remove ${unitAddress(unit, candidates)}`}
              disabled={running}
              onClick={() => onRemove(unit.candidate.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Glass>
  );
}

/**
 * Scene 1 `compare` step: the chosen units' listing facts and per-site changes, the Run
 * button and, while the run is going, the progress panel. Results are their own step.
 */
export function UnitComparison({
  units,
  selectedId,
  candidates,
  controller,
  payload,
  tweaks,
  onSelect,
  onEdit,
  onRemoveTweak,
  onViewResults,
  onChooseSite,
}: {
  units: WorkspaceCandidate[];
  selectedId?: string;
  candidates: WorkspaceCandidate[];
  controller: LiveComparisonController;
  /** The finished comparison matching these units and tweaks, if any. */
  payload: LiveComparisonPayload | null;
  onChooseSite?: (siteId: string) => void;
  tweaks: SiteTweakMap;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onRemoveTweak: (candidateId: string, field: keyof SiteTweaks) => void;
  onViewResults: () => void;
}) {
  const running = controller.phase === "running";
  const ready =
    units.length >= MIN_COMPARE_UNITS && units.length <= MAX_COMPARE_UNITS;
  const anyTweaks = units.some(
    (unit) => Object.keys(tweaks[unit.candidate.id] ?? {}).length > 0,
  );
  // A failed run (the founder's or the consultant's) keeps the selection and offers Retry.
  const failed = !running && Boolean(controller.runError);
  // The latest finished run shows below the Run button even when the choices changed since.
  const latest = finishedComparison(controller.payload);
  const stale = comparisonStaleness(
    latest,
    controller.selectedIds,
    controller.tweaksKey,
  );
  return (
    <Glass
      role="region"
      className={styles.unitComparison}
      aria-label="Unit comparison"
    >
      <ReportHeader
        phase="Compare"
        units={units}
        candidates={candidates}
        selectedId={selectedId}
      />
      <div className={styles.reportZoneHeading}>
        <div>
          <p className={styles.reportNumber}>01</p>
          <h3>Listing facts</h3>
          <p className="mt-1 text-xs opacity-75">
            {compareLabel(units.length)}
          </p>
        </div>
        <button
          className={styles.secondary}
          onClick={onEdit}
          disabled={running}
        >
          Edit choices
        </button>
      </div>
      {!ready ? (
        <p>Select two or three units from the map or list.</p>
      ) : (
        <>
          <table
            className={styles.unitFacts}
            data-agent-anchor="comparison_table"
          >
            <caption className="sr-only">
              Source listing facts for the {unitsWord(units.length)} chosen
              units
            </caption>
            <thead>
              <tr>
                <th scope="col" className="w-20">
                  Unit
                </th>
                {units.map((unit) => (
                  <th key={unit.candidate.id} scope="col">
                    <button
                      className="text-left underline underline-offset-4"
                      onClick={() => onSelect(unit.candidate.id)}
                    >
                      {unitAddress(unit, candidates)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Asking rent</th>
                {units.map((unit) => (
                  <td key={unit.candidate.id}>{rentText(unit)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Size</th>
                {units.map((unit) => (
                  <td key={unit.candidate.id}>{areaText(unit)}</td>
                ))}
              </tr>
              {anyTweaks && (
                <tr>
                  <th scope="row">Changes</th>
                  {units.map((unit) => (
                    <td key={unit.candidate.id}>
                      <SiteTweakChips
                        label={unitAddress(unit, candidates)}
                        tweaks={tweaks[unit.candidate.id]}
                        disabled={running}
                        onRemove={(field) =>
                          onRemoveTweak(unit.candidate.id, field)
                        }
                      />
                    </td>
                  ))}
                </tr>
              )}
              {units.some((unit) => listingNotes(unit).length > 0) && (
                <tr>
                  <th scope="row">Good to know</th>
                  {units.map((unit) => (
                    <td key={unit.candidate.id}>
                      {listingNotes(unit).map((note) => (
                        <p key={note} className="text-xs opacity-75">
                          {note}
                        </p>
                      ))}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          <div className="my-6 flex flex-wrap items-center gap-3">
            <button
              className={styles.primary}
              disabled={running || controller.phase === "loading"}
              onClick={() => void controller.run()}
            >
              {running
                ? "Running comparison…"
                : failed
                  ? "Retry comparison"
                  : payload
                    ? "Run again"
                    : anyTweaks
                      ? "Run with changes"
                      : "Run comparison"}
            </button>
            <span className="text-xs opacity-75">
              Modeled estimates; no measured foot traffic.
            </span>
          </div>
          {running && controller.activeRun && (
            <ComparisonProgress
              run={controller.activeRun}
              progress={controller.panelProgress}
              candidates={candidates}
            />
          )}
          {failed && (
            <p role="alert" className="mb-5 text-sm">
              {controller.runError}
            </p>
          )}
          {latest && !running && (
            <>
              <StaleBanner stale={stale} />
              <LocationResults
                payload={latest}
                candidates={candidates}
                onSelect={onSelect}
                onChoose={onChooseSite}
                framed={false}
              />
              <div className={styles.stepActions}>
                <button className={styles.primary} onClick={onViewResults}>
                  Continue to results
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Glass>
  );
}

function ReportHeader({
  phase,
  units,
  candidates,
  selectedId,
}: {
  phase: string;
  units: WorkspaceCandidate[];
  candidates: WorkspaceCandidate[];
  selectedId?: string;
}) {
  const selected =
    units.find((unit) => unit.candidate.id === selectedId) ?? units[0];
  return (
    <header className={styles.reportHeader}>
      <div>
        <p className={styles.resultsEyebrow}>Location report</p>
        <h2>
          {phase === "Compare" ? "Compare locations" : "Results & refine"}
        </h2>
        {selected && (
          <p className={styles.reportViewing}>
            Viewing: {unitAddress(selected, candidates)}
          </p>
        )}
      </div>
      <p>{units.length} selected locations</p>
    </header>
  );
}

/**
 * Scene 1 `results` step: the matching comparison, the per-site changes it used, and the
 * controls to change a site or rerun.
 */
export function ResultsStep({
  projectId,
  payload,
  units,
  selectedId,
  candidates,
  tweaks,
  loading,
  running,
  onSelect,
  onChangeSite,
  onRerun,
  onRemoveTweak,
  onChooseSite,
  stale = null,
}: {
  projectId?: string;
  payload: LiveComparisonPayload | null;
  onChooseSite?: (siteId: string) => void;
  /** Why this run is not for the current choices, if it is. Never hides the results. */
  stale?: Staleness;
  units: WorkspaceCandidate[];
  selectedId?: string;
  candidates: WorkspaceCandidate[];
  tweaks: SiteTweakMap;
  loading: boolean;
  running: boolean;
  onSelect: (id: string) => void;
  onChangeSite: () => void;
  onRerun: () => void;
  onRemoveTweak: (candidateId: string, field: keyof SiteTweaks) => void;
}) {
  const tweaked = units.filter(
    (unit) => Object.keys(tweaks[unit.candidate.id] ?? {}).length > 0,
  );
  return (
    <Glass
      role="region"
      className={styles.unitComparison}
      aria-label="Results"
      data-agent-anchor="comparison_recommendation"
    >
      <ReportHeader
        phase="Results"
        units={units}
        candidates={candidates}
        selectedId={selectedId}
      />
      {payload ? (
        <>
          <StaleBanner stale={stale} />
          <LocationResults
            payload={payload}
            candidates={candidates}
            onSelect={onSelect}
            onChoose={onChooseSite}
            framed={false}
          />
        </>
      ) : (
        <p role="status" className="text-sm">
          {loading
            ? "Loading results…"
            : "No finished comparison yet. Run a comparison first."}
        </p>
      )}
      {projectId && payload && !payload.comparison?.synthetic && (
        <div className={styles.reportZone}>
          <ServiceCounters
            projectId={projectId}
            payload={payload}
            candidates={candidates}
          />
        </div>
      )}
      {tweaked.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Changes in this run</h3>
          <div className="grid gap-2">
            {tweaked.map((unit) => (
              <div
                key={unit.candidate.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span>{unitAddress(unit, candidates)}</span>
                <SiteTweakChips
                  label={unitAddress(unit, candidates)}
                  tweaks={tweaks[unit.candidate.id]}
                  disabled={running}
                  onRemove={(field) => onRemoveTweak(unit.candidate.id, field)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.stepActions}>
        <button
          className={styles.secondary}
          onClick={onChangeSite}
          disabled={running}
        >
          Change a site
        </button>
        <button
          className={styles.primary}
          aria-label="Rerun"
          onClick={onRerun}
          disabled={running}
        >
          {stale ? "Rerun to update" : "Rerun"}
        </button>
      </div>
    </Glass>
  );
}

/** Current vs +1 vs +2 service counters for one modeled site, inside the results step. */
function ServiceCounters({
  projectId,
  payload,
  candidates,
}: {
  projectId: string;
  payload: LiveComparisonPayload;
  candidates: WorkspaceCandidate[];
}) {
  const modeled = payload.result.ranking.filter((id) =>
    payload.result.sites.some((site) => site.siteId === id),
  );
  const selectId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const siteId = picked && modeled.includes(picked) ? picked : modeled[0];
  if (!siteId) return null;
  const label = (id: string) => {
    const unit = candidates.find((entry) => entry.candidate.id === id);
    return unit ? unitAddress(unit, candidates) : id;
  };
  return (
    <div className="mt-6" data-service-counters>
      <div className={styles.counterHeading}>
        <h3>Counter setup</h3>
        {modeled.length > 1 && (
          <div className={styles.counterSelect}>
            <label htmlFor={selectId} className="sr-only">
              Counter setup location
            </label>
            <select
              id={selectId}
              value={siteId}
              onChange={(event) => setPicked(event.target.value)}
            >
              {modeled.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <StationCalloutController
        projectId={projectId}
        comparisonId={payload.comparisonId}
        siteId={siteId}
        profileId={payload.result.profileId}
        profileVersion={payload.result.profileVersion}
        seeds={payload.result.seeds}
        synthetic={false}
        modelVersion={payload.result.modelVersion}
        founderLabels
        compact
      />
    </div>
  );
}

/** A non-blocking note that the results on screen are for earlier choices. */
function StaleBanner({ stale }: { stale: Staleness }) {
  if (!stale) return null;
  return (
    <div
      role="status"
      className={styles.staleStatus}
      title={staleMessage(stale)}
    >
      Out of date
    </div>
  );
}
