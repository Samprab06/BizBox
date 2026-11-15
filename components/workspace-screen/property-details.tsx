"use client";

import Link from "next/link";
import type { SiteSearchReadiness } from "@/lib/client/use-site-search";
import { workspaceHref } from "@/lib/client/workspace-routes";
import {
  candidateMarkers,
  candidateFitReasons,
  searchFilterLabel,
  type WorkspaceCandidate,
  unitLabel,
  unitAddress,
} from "./client-model";
import { metricText } from "./model";
import styles from "./workspace-glass.module.css";

export function SearchFilterSummary({
  search,
}: {
  search: SiteSearchReadiness;
}) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      {search.status === "empty" || search.status === "ready" ? (
        <>
          {search.emptyReason && <p>{search.emptyReason}</p>}
          <p>
            {search.totalMatched.toLocaleString("en-US")} listings matched the
            saved filters.
          </p>
          <ul>
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

const rent = (entry: WorkspaceCandidate) =>
  entry.baseRentCents.value === null
    ? "Rent unknown"
    : metricText(entry.baseRentCents) + "/mo";
const area = (entry: WorkspaceCandidate) =>
  entry.candidate.floorAreaSqFt.value === null
    ? "Size unknown"
    : metricText(entry.candidate.floorAreaSqFt) + " sq ft";

export function PropertyDetails({
  selected,
  candidates,
  search,
  projectId,
  onSelect,
  onClose,
  onInterior,
  onCompare,
  compareDisabled,
  fullDetailsHref,
  comparisonAdded = false,
  comparisonFull = false,
  onChooseAnother,
}: {
  selected: WorkspaceCandidate;
  candidates: WorkspaceCandidate[];
  search?: SiteSearchReadiness;
  projectId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onInterior: () => void;
  onCompare?: () => void;
  compareDisabled?: boolean;
  fullDetailsHref?: string | null;
  comparisonAdded?: boolean;
  comparisonFull?: boolean;
  onChooseAnother?: () => void;
}) {
  const members = candidates
    .filter((entry) => entry.propertyId === selected.propertyId)
    .sort((a, b) =>
      a.candidate.id.localeCompare(b.candidate.id, "en", { numeric: true }),
    );
  const facts = Object.entries(selected.candidate.features)
    .filter(([, fact]) => fact.value === true && fact.origin === "costar")
    .map(
      ([key]) =>
        ({
          groundFloor: "Ground floor listed",
          parking: "Building parking listed",
          frontage: "Building frontage listed",
          corner: "Building corner listed",
        })[key] ?? key,
    );
  const fit = candidateFitReasons(
    selected,
    search?.status === "ready" ? search.profile : undefined,
  );
  return (
    <section
      className={styles.propertyPanel}
      aria-label="Selected location"
      tabIndex={-1}
      data-agent-anchor="site_summary"
    >
      <div className={styles.panelHeading}>
        <h2>{unitAddress(selected, candidates)}</h2>
        <button
          className={styles.secondary}
          onClick={onClose}
          aria-label="Close property details"
        >
          ×
        </button>
      </div>
      {!/^CoStar space /i.test(selected.candidate.name) && (
        <p className={styles.muted}>{selected.candidate.name}</p>
      )}
      {fit.length > 0 && <p className="mt-2 text-xs">{fit.join(" · ")}</p>}
      <dl className={styles.propertyFacts}>
        <div>
          <dt>Asking rent / month</dt>
          <dd>{rent(selected)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{area(selected)}</dd>
        </div>
      </dl>
      {facts.length > 0 && <p className="text-xs">{facts.join(" · ")}</p>}
      {members.length > 1 && (
        <section aria-label="Spaces at this location" className="mt-5">
          <h3>{members.length} units shown</h3>
          <div className={styles.unitList}>
            {members.map((entry) => (
              <button
                key={entry.candidate.id}
                className={styles.unit}
                aria-pressed={entry.candidate.id === selected.candidate.id}
                onClick={() => onSelect(entry.candidate.id)}
              >
                <strong>{unitLabel(entry, candidates)}</strong>
                <span>
                  {area(entry)} · {rent(entry)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {onCompare && (
          <button
            className={styles.primary}
            disabled={compareDisabled || (comparisonFull && !comparisonAdded)}
            onClick={onCompare}
          >
            {comparisonAdded ? "Remove from comparison" : "Add to comparison"}
          </button>
        )}
        {onChooseAnother && (
          <button className={styles.secondary} onClick={onChooseAnother}>
            Choose another unit
          </button>
        )}
        <button className={styles.secondary} onClick={onInterior}>
          View interior
        </button>
        {fullDetailsHref !== null && (
          <Link
            className={styles.secondary}
            href={
              fullDetailsHref ??
              workspaceHref(projectId, "site", selected.candidate.id)
            }
          >
            Full details
          </Link>
        )}
      </div>
      {comparisonFull && !comparisonAdded && (
        <p className="mt-3 text-xs">
          Three units selected. Remove one to add this unit.
        </p>
      )}
      <details className="mt-5 text-xs">
        <summary>Details</summary>
        <p className="mt-3">
          Property-level listing coordinates; 3D imagery coverage varies.
        </p>
        <p>
          Unit numbers label this shortlist; they are not broker suite numbers.
        </p>
        <p>Rent source: {selected.baseRentCents.origin}</p>
        <p>
          Property {selected.propertyId} · Listing {selected.listingId}
        </p>
        {selected.flags.map((flag) => (
          <p key={flag}>{flag}</p>
        ))}
        {search && <SearchFilterSummary search={search} />}
      </details>
    </section>
  );
}

export function ListingList({
  candidates,
  selectedId,
  selectedIds,
  running,
  search,
  onSelect,
  onCompareIds,
  onClose,
  maxSelected = Infinity,
  topIds = [],
}: {
  candidates: WorkspaceCandidate[];
  selectedId?: string;
  selectedIds: string[];
  running: boolean;
  search?: SiteSearchReadiness;
  onSelect: (id: string) => void;
  onCompareIds: (ids: string[]) => void;
  onClose: () => void;
  maxSelected?: number;
  /** Scene 1: the top locations, best first; each row shows its rank. */
  topIds?: readonly string[];
}) {
  const markers = candidateMarkers(candidates);
  return (
    <section
      className={styles.propertyPanel}
      aria-label="Location list"
      data-agent-anchor="candidate_list"
    >
      <div className={styles.panelHeading}>
        <h2>Locations</h2>
        <button
          className={styles.secondary}
          aria-label="Close location list"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className={styles.muted}>
        {candidates.length}
        {search?.status === "ready"
          ? ` of ${search.totalMatched.toLocaleString("en-US")}`
          : ""}{" "}
        matching units shown
      </p>
      <div
        className={styles.listRows}
        role="group"
        aria-label="Matching locations"
      >
        {candidates.map((entry) => {
          const marker = markers.find((group) =>
            group.members.some(
              (member) => member.siteId === entry.candidate.id,
            ),
          );
          return (
            <div key={entry.candidate.id} className={styles.listRow}>
              <button
                aria-label={"View " + unitAddress(entry, candidates)}
                aria-describedby={"listing-facts-" + entry.candidate.id}
                aria-pressed={selectedId === entry.candidate.id}
                onClick={() => onSelect(entry.candidate.id)}
              >
                <strong>{unitAddress(entry, candidates)}</strong>
              </button>
              {/* Facts sit beside the button so its accessible name matches its visible text. */}
              <div className={styles.listFacts}>
                <span id={"listing-facts-" + entry.candidate.id}>
                  {topIds.includes(entry.candidate.id) && (
                    <span className={styles.rankBadge}>
                      Top {topIds.indexOf(entry.candidate.id) + 1}
                    </span>
                  )}
                  {area(entry)} · {rent(entry)}
                </span>
                <span className={styles.muted}>
                  {marker ? `Map ${marker.index}` : "Coordinates unavailable"}
                </span>
              </div>
              <label>
                <input
                  type="checkbox"
                  aria-label={"Compare " + unitAddress(entry, candidates)}
                  checked={selectedIds.includes(entry.candidate.id)}
                  disabled={
                    running ||
                    (!selectedIds.includes(entry.candidate.id) &&
                      selectedIds.length >= maxSelected)
                  }
                  onChange={(event) =>
                    onCompareIds(
                      event.target.checked
                        ? [...new Set([...selectedIds, entry.candidate.id])]
                        : selectedIds.filter((id) => id !== entry.candidate.id),
                    )
                  }
                />{" "}
                Compare
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
