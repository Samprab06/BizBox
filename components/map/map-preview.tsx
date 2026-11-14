"use client";

import Link from "next/link";
import CandidateMap from "./candidate-map";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { useSiteSearch } from "@/lib/client/use-site-search";
import { getSiteFixture } from "@/components/site/site-fixtures";
import {
  LiveEvidence,
  Metric,
  evidenceHref,
} from "@/components/site/live-evidence";
import { workspaceHref } from "@/lib/client/workspace-routes";

export function MapPreview({
  project,
  selectedId,
}: {
  project: PreviewProject;
  selectedId?: string;
}) {
  const { state, retry } = useSiteSearch(project.id);
  if (state.mode === "loading")
    return <p role="status">Loading candidate sites…</p>;
  if (state.mode === "live") {
    const { result } = state;
    const sites = result.candidates.map(({ candidate }) => ({
      id: candidate.id,
      address: candidate.address,
      href: workspaceHref(project.id, "map", candidate.id),
      latitude: candidate.latitude.value,
      longitude: candidate.longitude.value,
    }));
    const selected = result.candidates.find(
      ({ candidate }) => candidate.id === selectedId,
    );
    return (
      <>
        <p className="mb-3 text-sm text-muted">
          Listings matched to the completed intake on this device.
        </p>
        {state.notes.map((note) => (
          <p key={note} className="mb-2 text-sm text-muted">
            {note}
          </p>
        ))}
        <section
          aria-label="Search diagnostics"
          className="mb-5 rounded-lg bg-paper p-4 text-sm"
        >
          <h2 className="font-semibold">
            Search diagnostics ·{" "}
            <a href="#diagnostic-source" className="text-pine underline">
              default
            </a>
          </h2>
          <p>
            Showing {result.candidates.length} of {result.totalMatched} matched
            spaces.
          </p>
          {result.mostRestrictiveFilter && (
            <p>Most restrictive filter: {result.mostRestrictiveFilter}</p>
          )}
          <ul>
            {result.filters.map((filter) => (
              <li key={filter.name}>
                {filter.name}: {filter.before} before · {filter.removed} removed
                · {filter.after} remaining
              </li>
            ))}
          </ul>
          <p id="diagnostic-source" className="mt-2 text-muted">
            Counts are derived from this search’s sequential filters, not
            observed market totals.
          </p>
        </section>
        {!sites.length ? (
          <p role="status">
            {result.emptyReason ?? "No candidate sites match your intake."}
          </p>
        ) : (
          <>
            <CandidateMap
              key={sites
                .map((site) => `${site.id}:${site.latitude}:${site.longitude}`)
                .join(";")}
              projectId={project.id}
              sites={sites}
              selectedId={selected?.candidate.id}
            />
            <ul
              aria-label="Candidate sites"
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              {result.candidates.map((entry) => (
                <li key={entry.candidate.id}>
                  <Link
                    className="block rounded-lg border border-line p-4 hover:bg-mint aria-[current=true]:border-pine aria-[current=true]:bg-mint"
                    href={workspaceHref(project.id, "map", entry.candidate.id)}
                    aria-current={
                      selected?.candidate.id === entry.candidate.id || undefined
                    }
                  >
                    <strong>{entry.candidate.address}</strong>
                    <span className="block text-sm text-muted">
                      {entry.candidate.name} · {entry.candidate.city}
                    </span>
                    {(entry.candidate.latitude.value === null ||
                      entry.candidate.longitude.value === null) && (
                      <span className="block text-sm">
                        Coordinates unknown · available in list only
                      </span>
                    )}
                    {entry.flags.length > 0 && (
                      <span className="mt-2 block text-sm text-muted">
                        Flags: {entry.flags.join(", ")}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {selected && (
              <>
                <Link
                  className="mt-4 inline-block font-semibold text-pine underline"
                  href={workspaceHref(
                    project.id,
                    "site",
                    selected.candidate.id,
                  )}
                >
                  View details for {selected.candidate.address}
                </Link>
                <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt>Size</dt>
                    <dd>
                      <Metric metric={selected.candidate.floorAreaSqFt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Monthly asking rent</dt>
                    <dd>
                      <Metric metric={selected.baseRentCents} />
                    </dd>
                  </div>
                  <div>
                    <dt>Prescore</dt>
                    <dd>
                      <a
                        className="text-pine underline"
                        href={evidenceHref(selected.scoreEvidenceId)}
                      >
                        {selected.score} / 100 · default
                      </a>
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </>
        )}
        <button
          type="button"
          className="mt-4 rounded bg-pine px-3 py-2 text-white"
          onClick={retry}
        >
          Retry search
        </button>
        <LiveEvidence search={result.evidence} />
      </>
    );
  }
  return (
    <>
      <div className="mb-5 rounded-lg bg-paper p-4">
        <p role={state.failed ? "alert" : "status"}>{state.message}</p>
        <Link
          href={workspaceHref(project.id, "intake")}
          className="mt-2 inline-block text-pine underline"
        >
          Review intake
        </Link>
        <button
          type="button"
          className="ml-4 rounded bg-pine px-3 py-2 text-white"
          onClick={retry}
        >
          Retry search
        </button>
      </div>
      <ExampleMap project={project} selectedId={selectedId} />
      <p className="mt-6 text-xs text-muted">Example data</p>
    </>
  );
}

function ExampleMap({
  project,
  selectedId,
}: {
  project: PreviewProject;
  selectedId?: string;
}) {
  const sites = project.sites.map((site) => ({
    ...site,
    latitude: getSiteFixture(site.id)?.latitude ?? null,
    longitude: getSiteFixture(site.id)?.longitude ?? null,
    href: workspaceHref(project.id, "map", site.id),
  }));
  const selected = sites.find((site) => site.id === selectedId);

  if (!sites.length) return <p role="status">No candidate sites yet.</p>;
  return (
    <>
      <CandidateMap
        projectId={project.id}
        sites={sites}
        selectedId={selected?.id}
        example
      />
      <ul
        aria-label="Candidate sites"
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        {sites.map((site) => (
          <li key={site.id}>
            <Link
              className="block rounded-lg border border-line p-4 hover:bg-mint aria-[current=true]:border-pine aria-[current=true]:bg-mint"
              aria-current={selected?.id === site.id || undefined}
              href={site.href}
            >
              <strong>{site.address}</strong>
              <span className="block text-sm text-muted">
                {site.neighborhood}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {selected && (
        <Link
          className="mt-4 inline-block font-semibold text-pine underline"
          href={workspaceHref(project.id, "site", selected.id)}
        >
          View details for {selected.address}
        </Link>
      )}
    </>
  );
}
