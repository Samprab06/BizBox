"use client";
import { useState } from "react";
import type {
  LiveComparisonController,
  LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import { unitAddress, type WorkspaceCandidate } from "./client-model";
import { metricText } from "./model";
import { LocationResults } from "./location-results";
import styles from "./workspace-glass.module.css";

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
  return (
    <section className={styles.shortlist} aria-label="Comparison shortlist">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm">Comparison {units.length}/2</h2>
        <button
          className={styles.primary}
          disabled={units.length !== 2 || running}
          onClick={onCompare}
        >
          Compare 2 units
        </button>
      </div>
      <div className={styles.shortlistUnits}>
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

export function UnitComparison({
  units,
  candidates,
  controller,
  payload,
  onSelect,
  onEdit,
}: {
  units: WorkspaceCandidate[];
  candidates: WorkspaceCandidate[];
  controller: LiveComparisonController;
  payload: LiveComparisonPayload | null;
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const [runKey, setRunKey] = useState<string | null>(null);
  const key = units
    .map((unit) => unit.candidate.id)
    .sort()
    .join("|");
  const running = controller.phase === "running";
  const ran = runKey === key;
  return (
    <section className={styles.unitComparison} aria-label="Unit comparison">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Compare 2 units</h2>
          <p className="mt-2 text-xs opacity-75">Listing facts</p>
        </div>
        <button className={styles.secondary} onClick={onEdit}>
          Edit choices
        </button>
      </div>
      {units.length !== 2 ? (
        <p>Select two units from the map or list.</p>
      ) : (
        <>
          <table className={styles.unitFacts}>
            <caption className="sr-only">
              Source listing facts for the two chosen units
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
              onClick={() => {
                setRunKey(key);
                void controller.run();
              }}
            >
              {running
                ? "Running comparison…"
                : ran && controller.phase === "example"
                  ? "Retry comparison"
                  : "Run comparison"}
            </button>
            <span className="text-xs opacity-75">
              Modeled estimates; no measured foot traffic.
            </span>
          </div>
          {running && (
            <p role="status" className="text-sm">
              Running comparison for these two units…
            </p>
          )}
          {ran && controller.phase === "example" && (
            <p role="alert" className="mb-5 text-sm">
              {controller.message}
            </p>
          )}
          {ran && payload && (
            <LocationResults
              payload={payload}
              candidates={candidates}
              onSelect={onSelect}
              framed={false}
            />
          )}
        </>
      )}
    </section>
  );
}
