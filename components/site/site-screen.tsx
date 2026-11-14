"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AssumedValue } from "@/lib/contracts";
import type { SiteInsights } from "@/lib/contracts/insights";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import {
  CatchmentResponseSchema,
  type CatchmentResponse,
} from "@/lib/contracts/catchment";
import { useSiteSearch } from "@/lib/client/use-site-search";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { SiteDetail } from "./site-detail";
import { LiveEvidence, Metric } from "./live-evidence";
import { InsightsWorkspace } from "@/components/insights/insights-workspace";

export function SiteScreen({
  project,
  siteId,
  fixtureInsights,
}: {
  project: PreviewProject;
  siteId: string;
  fixtureInsights?: SiteInsights;
}) {
  const example = project.sites.find((site) => site.id === siteId);
  if (example)
    return (
      <>
        <p className="mb-4 text-sm text-muted">
          These are example listing details.{" "}
          <Link
            href={workspaceHref(project.id, "map")}
            className="text-pine underline"
          >
            Search with your completed intake
          </Link>{" "}
          for current listings.
        </p>
        <SiteDetail
          project={project}
          site={example}
          insights={fixtureInsights}
        />
        <p className="mt-6 text-xs text-muted">Example data</p>
      </>
    );
  if (siteId === "unselected")
    return (
      <>
        <p role="status">Choose a site from the map to view details.</p>
        <BackToMap projectId={project.id} />
      </>
    );
  return (
    <>
      <LiveSiteDetail project={project} siteId={siteId} />
      <InsightsWorkspace key={siteId} projectId={project.id} siteId={siteId} />
    </>
  );
}

type CatchmentState =
  | { kind: "loading" }
  | { kind: "failed"; notFound: boolean }
  | { kind: "ready"; response: CatchmentResponse };

function LiveSiteDetail({
  project,
  siteId,
}: {
  project: PreviewProject;
  siteId: string;
}) {
  const { state, retry } = useSiteSearch(project.id);
  if (state.mode === "loading")
    return <p role="status">Loading listing details…</p>;
  if (state.mode === "example")
    return (
      <>
        <p role={state.failed ? "alert" : "status"}>
          {state.message} The requested listing cannot be verified.
        </p>
        <button
          className="mt-3 rounded bg-pine px-3 py-2 text-white"
          type="button"
          onClick={retry}
        >
          Retry search
        </button>
        <Link
          className="ml-4 text-pine underline"
          href={workspaceHref(project.id, "intake")}
        >
          Review intake
        </Link>
        <BackToMap projectId={project.id} siteId={siteId} />
        <details className="mt-6 rounded-lg border border-line p-4">
          <summary className="cursor-pointer font-semibold">
            View example site details
          </summary>
          <p className="my-3 text-sm text-muted">Example data</p>
          <SiteDetail project={project} site={project.sites[0]} />
        </details>
      </>
    );
  const entry = state.result.candidates.find(
    ({ candidate }) => candidate.id === siteId,
  );
  if (!entry)
    return (
      <>
        <p role="status">Site not found in the current search.</p>
        <p className="mt-2 text-sm text-muted">
          The listing may no longer match this intake. Choose a current
          candidate or review your intake.
        </p>
        <BackToMap projectId={project.id} siteId={siteId} />
        <button
          className="mt-3 rounded bg-pine px-3 py-2 text-white"
          type="button"
          onClick={retry}
        >
          Retry search
        </button>
      </>
    );
  return (
    <>
      <BackToMap projectId={project.id} siteId={siteId} />
      <h2 className="mt-4 text-2xl font-semibold">{entry.candidate.address}</h2>
      <p className="mt-1 text-muted">
        {entry.candidate.name} · {entry.candidate.city}
      </p>
      {state.notes.map((note) => (
        <p key={note} className="mt-2 text-sm text-muted">
          {note}
        </p>
      ))}
      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">Size</dt>
          <dd className="mt-1">
            <Metric metric={entry.candidate.floorAreaSqFt} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Monthly asking rent</dt>
          <dd className="mt-1">
            <Metric metric={entry.baseRentCents} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Monthly operating expenses</dt>
          <dd className="mt-1">
            <Metric metric={entry.opexCents} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Total monthly occupancy cost</dt>
          <dd className="mt-1">
            <Metric metric={entry.totalMonthlyCostCents} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Position</dt>
          <dd className="mt-1">{entry.position ?? "Unknown"} · costar</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Latitude</dt>
          <dd className="mt-1">
            <Metric metric={entry.candidate.latitude} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Longitude</dt>
          <dd className="mt-1">
            <Metric metric={entry.candidate.longitude} />
          </dd>
        </div>
      </dl>
      {entry.flags.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          Listing flags: {entry.flags.join(", ")}
        </p>
      )}
      <SiteCatchment
        projectId={project.id}
        exampleProject={project}
        siteId={siteId}
        category={state.profile.category}
        searchEvidence={state.result.evidence}
      />
    </>
  );
}

function SiteCatchment({
  projectId,
  exampleProject,
  siteId,
  category,
  searchEvidence,
}: {
  projectId: string;
  exampleProject: PreviewProject;
  siteId: string;
  category: string;
  searchEvidence: SiteSearchResult["evidence"];
}) {
  const [state, setState] = useState<CatchmentState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      try {
        const query = new URLSearchParams({
          projectId,
          category,
        });
        const response = await fetch(
          `/api/sites/${encodeURIComponent(siteId)}/catchment?${query}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) {
          if (!disposed)
            setState({ kind: "failed", notFound: response.status === 404 });
          return;
        }
        const result = CatchmentResponseSchema.parse(await response.json());
        if (
          result.catchment.siteId !== siteId ||
          result.catchment.projectId !== projectId
        )
          throw new Error("Catchment identity mismatch");
        if (!disposed) setState({ kind: "ready", response: result });
      } catch {
        if (!disposed) setState({ kind: "failed", notFound: false });
      }
    }
    void load().finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, siteId, category, attempt]);
  return (
    <>
      <section
        aria-label="Catchment"
        className="mt-8 border-t border-line pt-5"
      >
        <h3 className="text-xl font-semibold">Catchment</h3>
        {state.kind === "loading" && (
          <p role="status" className="mt-3">
            Loading catchment evidence…
          </p>
        )}
        {state.kind === "failed" && (
          <>
            <p role="alert" className="mt-3">
              {state.notFound
                ? "Catchment unavailable: this site was not found."
                : "Catchment unavailable. Resident, worker and traffic values have not been substituted."}
            </p>
            <button
              type="button"
              className="mt-3 rounded bg-pine px-3 py-2 text-white"
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((value) => value + 1);
              }}
            >
              Retry catchment
            </button>
            {!state.notFound && (
              <details className="mt-4 rounded-lg border border-line p-4">
                <summary className="cursor-pointer font-semibold">
                  View example site details
                </summary>
                <p className="my-3 text-sm text-muted">Example data</p>
                <SiteDetail
                  project={exampleProject}
                  site={exampleProject.sites[0]}
                />
              </details>
            )}
          </>
        )}
        {state.kind === "ready" && <CatchmentFacts response={state.response} />}
      </section>
      <LiveEvidence
        search={searchEvidence}
        catchment={state.kind === "ready" ? state.response.evidence : []}
      />
    </>
  );
}

function CatchmentFacts({ response }: { response: CatchmentResponse }) {
  const facts: [string, AssumedValue][] = [
    ["Catchment radius", response.catchment.radiusMeters],
    ["Residents", response.residents.population],
    ["Households", response.residents.households],
    ["Workers (workplace jobs)", response.workers.jobs],
    ["Pass-by vehicles per day", response.passBy.vehiclesPerDay],
  ];
  return (
    <>
      <p className="mt-2 text-sm text-muted">
        Circular geographic range, not a walking or driving isochrone.
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, metric]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1">
              <Metric metric={metric} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">
        Vehicles are not people, pedestrians, visits, or customers. Workplace
        jobs are not unique visitors.
      </p>
      <p className="mt-2 text-sm text-muted">
        {response.passBy.missingTrafficCount.value === true
          ? "Missing traffic count · default estimate. "
          : ""}
        {response.passBy.selection}
      </p>
      <h4 className="mt-6 font-semibold">Competitors</h4>
      {response.competitors.length ? (
        <ul className="mt-2 grid gap-3">
          {response.competitors.map((entry) => (
            <li key={entry.id}>
              {entry.name ?? "Unnamed competitor"} · {entry.category} ·{" "}
              <Metric metric={entry.distanceMeters} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No competitors returned; coverage may be incomplete.
        </p>
      )}
      <h4 className="mt-6 font-semibold">Co-tenants</h4>
      {response.coTenants.length ? (
        <ul className="mt-2 grid gap-3">
          {response.coTenants.map((entry) => (
            <li key={entry.id}>
              {entry.name ?? "Unnamed tenant"} ·{" "}
              {entry.industry ?? "Industry unknown"} · {entry.role} (
              {entry.roleOrigin} heuristic) ·{" "}
              <Metric metric={entry.occupiedSqFt} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No co-tenants returned; occupancy is not assumed empty.
        </p>
      )}
      {response.limitations.map((note) => (
        <p className="mt-3 text-sm text-muted" key={note}>
          {note}
        </p>
      ))}
    </>
  );
}

function BackToMap({
  projectId,
  siteId,
}: {
  projectId: string;
  siteId?: string;
}) {
  return (
    <Link
      href={workspaceHref(projectId, "map", siteId)}
      className="mt-3 block text-sm font-semibold text-pine underline"
    >
      Back to map
    </Link>
  );
}
