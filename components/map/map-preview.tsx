"use client";
import { Button } from "@/components/ui/button";

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
import { FinishBriefNotice } from "@/components/shell/finish-brief-notice";

export function MapPreview({
  project,
  selectedId,
}: {
  project: PreviewProject;
  selectedId?: string;
}) {
  const { state, readiness, retry } = useSiteSearch(project.id);
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
          className="mb-5 rounded-lg bg-canvas p-4 text-sm"
        >
          <h2 className="font-semibold">
            Search diagnostics ·{" "}
            <a href="#diagnostic-source" className="text-accent underline">
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
                    className="block rounded-lg border border-line p-4 hover:bg-field aria-[current=true]:border-accent aria-[current=true]:bg-field"
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
                  className="mt-4 inline-block font-semibold text-accent underline"
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
                        className="text-accent underline"
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
        <Button
          variant="primary"
          type="button"
          className="mt-4 rounded bg-accent px-3 py-2 text-on-accent"
          onClick={retry}
        >
          Retry search
        </Button>
        <LiveEvidence search={result.evidence} />
      </>
    );
  }
  return (
    <>
      {readiness.status === "needs_brief" ? (
        <FinishBriefNotice projectId={project.id} message={readiness.message} />
      ) : (
        <div className="mb-5 rounded-lg bg-canvas p-4">
          <p role={state.failed ? "alert" : "status"}>{state.message}</p>
          <Link
            href={workspaceHref(project.id, "intake")}
            className="mt-2 inline-block text-accent underline"
          >
            Review intake
          </Link>
          <Button
            variant="primary"
            type="button"
            className="ml-4 rounded bg-accent px-3 py-2 text-on-accent"
            onClick={retry}
          >
            Retry search
          </Button>
        </div>
      )}
      {project.sites.length > 0 && (
        <>
          <p className="my-4 text-xs text-muted">Example data</p>
          <ExampleMap project={project} selectedId={selectedId} />
        </>
      )}
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
              className="block rounded-lg border border-line p-4 hover:bg-field aria-[current=true]:border-accent aria-[current=true]:bg-field"
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
          className="mt-4 inline-block font-semibold text-accent underline"
          href={workspaceHref(project.id, "site", selected.id)}
        >
          View details for {selected.address}
        </Link>
      )}
    </>
  );
}
