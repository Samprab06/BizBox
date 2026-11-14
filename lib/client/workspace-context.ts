import { z } from "zod";
import { intakeSessionSchema } from "@/components/intake/profile";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { workspaceHref } from "./workspace-routes";

export type ContextListing = {
  id: string;
  name: string;
  address: string;
  synthetic: boolean;
};
export type WorkspaceObservation =
  | {
      kind: "search";
      phase: "loading" | "example" | "live";
      candidates: ContextListing[];
      evidenceId?: string;
    }
  | {
      kind: "comparison" | "stored";
      phase: "loading" | "ready" | "running" | "example";
      comparisonId?: string;
      synthetic?: boolean;
      outdated?: boolean;
      siteIds: string[];
      candidates: ContextListing[];
    }
  | {
      kind: "plan";
      phase: "loading" | "ready" | "outdated" | "error";
      comparisonId?: string;
      synthetic?: boolean;
      siteIds: string[];
    }
  | {
      kind: "replay";
      phase: "loading" | "ready" | "example" | "missing";
      siteId?: string;
      synthetic?: boolean;
    };
export type WorkspaceReport = {
  projectId: string;
  routeKey: string;
  observation: WorkspaceObservation;
};
export type ContextField = { text: string; href: string };
export type WorkspaceContextModel = {
  concept: ContextField;
  location: ContextField;
  scenario: ContextField;
  status: ContextField;
  qualifier?: string;
  example: boolean;
};

export function conceptFromSession(raw: string | null): string | null {
  try {
    const session = intakeSessionSchema.parse(JSON.parse(raw ?? "null"));
    return session.profile.concept?.value.trim() || null;
  } catch {
    return null;
  }
}

const planSourceSchema = z.object({
  comparisonId: z.string(),
  result: z.object({
    projectId: z.string(),
    ranking: z.array(z.string()).optional(),
  }),
  comparison: z.object({ synthetic: z.boolean() }).optional(),
});

/** Metadata only; the export's existing validator still owns printable facts. */
export function planContextSource(
  raw: unknown,
  projectId: string,
  comparisonId: string,
) {
  const parsed = planSourceSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.comparisonId !== comparisonId ||
    parsed.data.result.projectId !== projectId
  )
    return null;
  return {
    comparisonId,
    synthetic: parsed.data.comparison?.synthetic,
    siteIds: parsed.data.result.ranking ?? [],
  };
}

export function reportsForRoute(
  reports: Record<string, WorkspaceReport>,
  projectId: string,
  routeKey: string,
): WorkspaceObservation[] {
  return Object.values(reports)
    .filter(
      (report) =>
        report.projectId === projectId && report.routeKey === routeKey,
    )
    .map((report) => report.observation);
}

/** Resolves the data actually displayed; URL IDs alone never prove live provenance. */
export function resolveWorkspaceContext({
  project,
  pathname,
  search,
  concept,
  observations,
}: {
  project: PreviewProject;
  pathname: string;
  search: string;
  concept: string | null;
  observations: WorkspaceObservation[];
}): WorkspaceContextModel {
  const query = new URLSearchParams(search);
  const one = (key: string) => {
    const values = query.getAll(key);
    return values.length === 1 ? values[0] || undefined : undefined;
  };
  const detailMatch = pathname.match(/\/sites\/([^/]+)$/);
  let requested = one("site");
  if (detailMatch) {
    try {
      requested = decodeURIComponent(detailMatch[1]);
    } catch {
      requested = undefined;
    }
  }
  const view = detailMatch ? "site" : pathname.split("/").at(-1);
  const isComparison = view === "comparison";
  const isReplay = view === "replay";
  const isPlan = view === "plan";
  const isModel = isComparison || isReplay || isPlan;
  const searchState = observations.find((entry) => entry.kind === "search");
  const comparisonState = observations.find(
    (entry) => entry.kind === (isReplay ? "stored" : "comparison"),
  );
  const replayState = observations.find((entry) => entry.kind === "replay");
  const currentComparison =
    comparisonState &&
    (comparisonState.kind === "comparison" || comparisonState.kind === "stored")
      ? comparisonState
      : undefined;
  const currentSearch =
    searchState?.kind === "search" ? searchState : undefined;
  const currentReplay =
    replayState?.kind === "replay" &&
    replayState.siteId === (requested ?? currentComparison?.siteIds[0])
      ? replayState
      : undefined;
  const wantedComparison = one("comparison");
  const comparisonMatches =
    !wantedComparison ||
    !currentComparison?.comparisonId ||
    wantedComparison === currentComparison.comparisonId;
  const fixtureRequested = project.sites.find((site) => site.id === requested);
  let selectedId = requested;
  let example = false;
  let status = "Loading context…";
  let candidates: ContextListing[] = currentSearch?.candidates ?? [];

  if (isPlan) {
    const plan = observations.find((entry) => entry.kind === "plan");
    if (!wantedComparison) status = "Choose a comparison";
    else if (plan?.kind === "plan" && plan.comparisonId === wantedComparison) {
      if (plan.phase === "error") status = "Plan unavailable";
      else if (plan.phase === "outdated") {
        status = "Outdated comparison";
        example = plan.synthetic === true;
      } else if (plan.phase === "ready") {
        example = plan.synthetic === true;
        status = example
          ? "Example data"
          : plan.synthetic === undefined
            ? "Plan provenance unavailable"
            : "Stored plan";
        if (!plan.siteIds.includes(selectedId ?? ""))
          selectedId = plan.siteIds.length === 1 ? plan.siteIds[0] : undefined;
      }
    }
  } else if (isModel) {
    if (
      currentComparison &&
      comparisonMatches &&
      currentComparison.phase !== "loading"
    ) {
      candidates = currentComparison.candidates;
      if (
        currentComparison.phase === "example" ||
        (isReplay && currentReplay?.phase === "example")
      ) {
        example = true;
        selectedId = fixtureRequested?.id ?? project.sites[0]?.id;
        status = "Example data";
      } else if (
        isReplay &&
        (!currentReplay || currentReplay.phase === "loading")
      ) {
        status = "Loading context…";
      } else if (isReplay && currentReplay?.phase === "missing") {
        status = "No stored run for this location";
      } else if (!currentComparison.comparisonId) {
        example = candidates.some((site) => site.synthetic);
        status = example
          ? "Example data"
          : currentComparison.phase === "running"
            ? "Running comparison…"
            : "Ready to compare";
        selectedId = candidates.some((site) => site.id === requested)
          ? requested
          : undefined;
      } else {
        if (!currentComparison.siteIds.includes(selectedId ?? ""))
          selectedId = isReplay
            ? (requested ?? currentComparison.siteIds[0])
            : currentComparison.siteIds.length === 1
              ? currentComparison.siteIds[0]
              : undefined;
        const synthetic = isReplay
          ? currentReplay?.synthetic
          : currentComparison.synthetic;
        example = synthetic === true;
        status = example
          ? "Example data"
          : synthetic === undefined
            ? "Comparison provenance unavailable"
            : isReplay
              ? "Stored simulation"
              : currentComparison.outdated
                ? "Outdated comparison"
                : "Live comparison";
      }
    } else selectedId = undefined;
  } else if (view === "site" && fixtureRequested) {
    example = true;
    status = "Example data";
  } else if (view === "intake") {
    selectedId = requested;
    example = project.sites.some((site) => site.id === selectedId);
    status = example ? "Example data" : "Your input";
  } else if (currentSearch?.phase === "example") {
    example = view === "map";
    status = example ? "Example data" : "Listing unavailable";
  } else if (currentSearch?.phase === "live") {
    const selected = candidates.find((site) => site.id === selectedId);
    example =
      selected?.synthetic ??
      (candidates.length > 0 && candidates.every((site) => site.synthetic));
    status = example
      ? "Example data"
      : !candidates.length
        ? "No matching listings"
        : view === "site" && !selected
          ? "Listing unavailable"
          : "Live listings";
  }

  const fixture = example
    ? project.sites.find((site) => site.id === selectedId)
    : undefined;
  const listing = candidates.find((site) => site.id === selectedId);
  const location =
    fixture?.address ??
    (listing
      ? `${listing.name} · ${listing.address}`
      : selectedId
        ? `Site ${selectedId} · address unavailable`
        : isModel &&
            currentComparison?.comparisonId &&
            comparisonMatches &&
            currentComparison.siteIds.length > 1
          ? `${currentComparison.siteIds.length} compared locations`
          : "Choose a location");
  const mapHref = workspaceHref(project.id, "map", selectedId);
  const scenarioHref = workspaceHref(project.id, "comparison", selectedId);
  const comparisonId = comparisonMatches
    ? (currentComparison?.comparisonId ?? wantedComparison)
    : wantedComparison;
  let evidenceHref = selectedId
    ? workspaceHref(project.id, "site", selectedId)
    : mapHref;
  if (fixture) evidenceHref += "#listing-source";
  else if (listing && currentSearch?.evidenceId)
    evidenceHref += `#${encodeURIComponent(`evidence-${encodeURIComponent(currentSearch.evidenceId)}`)}`;
  return {
    concept: {
      text: concept ?? "Describe your business",
      href: workspaceHref(project.id, "intake", selectedId),
    },
    location: { text: location, href: mapHref },
    scenario: {
      text: "Baseline",
      href:
        scenarioHref +
        (comparisonId
          ? `${scenarioHref.includes("?") ? "&" : "?"}comparison=${encodeURIComponent(comparisonId)}`
          : ""),
    },
    status: { text: status, href: evidenceHref },
    qualifier: isModel ? "Modeled, not a forecast" : undefined,
    example,
  };
}
