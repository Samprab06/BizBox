"use client";

import { Glass } from "@/components/ui/glass";
import { MAX_COMPARE_UNITS } from "@/lib/contracts/evaluation";
import { unitAddress, type WorkspaceCandidate } from "./client-model";
import { metricText } from "./model";
import styles from "./workspace-glass.module.css";

/**
 * Scene 1: the founder's top locations, numbered 1-3 best first: the consultant's picks
 * (`present_top_sites`) or, before it has spoken, the search's three best-ranked units.
 */
export function TopSites({
  ids,
  candidates,
  selectedIds,
  presented,
  running,
  onSelect,
  onToggle,
}: {
  ids: readonly string[];
  candidates: readonly WorkspaceCandidate[];
  selectedIds: readonly string[];
  /** True when the consultant picked these; false for the search's own ranking. */
  presented: boolean;
  running: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const units = ids.flatMap((id) => {
    const entry = candidates.find((candidate) => candidate.candidate.id === id);
    return entry ? [entry] : [];
  });
  if (!units.length) return null;
  const full = selectedIds.length >= MAX_COMPARE_UNITS;
  return (
    <Glass
      role="region"
      className={styles.topSites}
      aria-label="Top locations"
      data-agent-anchor="candidate_list"
    >
      <h2 className="text-sm font-semibold">
        {presented ? "Your top locations" : "Best-ranked locations"}
      </h2>
      <ol>
        {units.map((unit, index) => {
          const label = unitAddress(unit, candidates);
          const chosen = selectedIds.includes(unit.candidate.id);
          return (
            <li
              key={unit.candidate.id}
              className={styles.topSite}
              data-selected={chosen}
            >
              <span className={styles.topRank} aria-hidden="true">
                {index + 1}
              </span>
              <div className="min-w-0">
                <button
                  className="text-left text-xs font-semibold underline underline-offset-4"
                  aria-label={`Top ${index + 1}: view ${label}`}
                  onClick={() => onSelect(unit.candidate.id)}
                >
                  {label}
                </button>
                <span className="mt-1 block text-xs opacity-75">
                  {metricText(unit.baseRentCents)}/mo ·{" "}
                  {metricText(unit.candidate.floorAreaSqFt)} sq ft
                </span>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={chosen}
                  disabled={running || (!chosen && full)}
                  onChange={() => onToggle(unit.candidate.id)}
                  aria-label={`Compare top ${index + 1}: ${label}`}
                />
                Compare
              </label>
            </li>
          );
        })}
      </ol>
    </Glass>
  );
}
