"use client";
import type {
  LiveComparisonController,
  LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import {
  MAX_COMPARE_UNITS,
  type SiteTweakMap,
  type SiteTweaks,
} from "@/lib/contracts/evaluation";
import { unitAddress, type WorkspaceCandidate } from "./client-model";
import { metricText } from "./model";
import { LocationResults } from "./location-results";
import { ComparisonProgress } from "./comparison-progress";
import { SiteTweakChips } from "./site-tweaks";
import styles from "./workspace-glass.module.css";

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
    <section className={styles.shortlist} aria-label="Comparison shortlist">
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
                {metricText(unit.baseRentCents)}/mo ·{" "}
                {metricText(unit.candidate.floorAreaSqFt)} sq ft
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
    </section>
  );
}

/**
 * Scene 1 `compare` step: the chosen units' listing facts and per-site changes, the Run
 * button and, while the run is going, the progress panel. Results are their own step.
 */
export function UnitComparison({
  units,
  candidates,
  controller,
  payload,
  tweaks,
  onSelect,
  onEdit,
  onRemoveTweak,
  onViewResults,
}: {
  units: WorkspaceCandidate[];
  candidates: WorkspaceCandidate[];
  controller: LiveComparisonController;
  /** The finished comparison matching these units and tweaks, if any. */
  payload: LiveComparisonPayload | null;
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
  return (
    <section className={styles.unitComparison} aria-label="Unit comparison">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">
            {compareLabel(units.length)}
          </h2>
          <p className="mt-2 text-xs opacity-75">Listing facts</p>
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
        <p>
          Select two or three units from the map or list.
        </p>
      ) : (
        <>
          <table className={styles.unitFacts} data-agent-anchor="comparison_table">
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
                  <td key={unit.candidate.id}>
                    {metricText(unit.baseRentCents)}/mo
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Size</th>
                {units.map((unit) => (
                  <td key={unit.candidate.id}>
                    {metricText(unit.candidate.floorAreaSqFt)} sq ft
                  </td>
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
              <tr>
                <th scope="row">Notes</th>
                {units.map((unit) => (
                  <td key={unit.candidate.id}>
                    <details>
                      <summary>Listing notes</summary>
                      {unit.flags.length ? (
                        unit.flags.map((flag) => <p key={flag}>{flag}</p>)
                      ) : (
                        <p>No additional notes returned.</p>
                      )}
                    </details>
                  </td>
                ))}
              </tr>
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
            {payload && !running && (
              <button className={styles.secondary} onClick={onViewResults}>
                View results
              </button>
            )}
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
        </>
      )}
    </section>
  );
}

/**
 * Scene 1 `results` step: the matching comparison, the per-site changes it used, and the
 * controls to change a site or rerun.
 */
export function ResultsStep({
  payload,
  units,
  candidates,
  tweaks,
  loading,
  running,
  onSelect,
  onChangeSite,
  onRerun,
  onRemoveTweak,
}: {
  payload: LiveComparisonPayload | null;
  units: WorkspaceCandidate[];
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
    <section
      className={styles.unitComparison}
      aria-label="Results"
      data-agent-anchor="comparison_recommendation"
    >
      {payload ? (
        <LocationResults
          payload={payload}
          candidates={candidates}
          onSelect={onSelect}
          framed={false}
        />
      ) : (
        <p role="status" className="text-sm">
          {loading
            ? "Loading results…"
            : "These results no longer match your selection. Rerun the comparison."}
        </p>
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
        <button className={styles.primary} onClick={onRerun} disabled={running}>
          Rerun
        </button>
      </div>
    </section>
  );
}
