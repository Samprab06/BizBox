import {
  AgentStageSchema,
  AgentViewContextSchema,
  MAX_VIEW_CANDIDATES,
  type AgentViewContext,
} from "@/lib/contracts/agent";
import { MAX_COMPARE_UNITS } from "@/lib/contracts/evaluation";
import { flowStepFromLocation } from "./flow-progress";
import {
  reportsForRoute,
  type WorkspaceObservation,
  type WorkspaceReport,
} from "./workspace-context";

/** Only the active registry publication proves an ID is displayed. URL IDs alone do not. */
export function agentViewForRoute(
  projectId: string,
  pathname: string,
  search: string,
  reports: Record<string, WorkspaceReport>,
): AgentViewContext {
  const detail = pathname.match(/\/sites\/([^/]+)$/);
  const stage = AgentStageSchema.safeParse(
    detail ? "site" : pathname.split("/").at(-1),
  );
  // Scene 1: the guided-flow step comes from the URL alone (the stepper's own rule).
  const step = flowStepFromLocation(pathname, search);
  const flowStep = step ? { step } : {};
  const view: AgentViewContext = {
    stage: stage.success ? stage.data : "workspace",
    ...flowStep,
  };
  const observations = reportsForRoute(
    reports,
    projectId,
    `${pathname}?${search}`,
  );
  const interior = observations.find((entry) => entry.kind === "interior");
  if (
    (step === "interior" || step === "finalize") &&
    interior?.kind === "interior" &&
    interior.phase === "ready" &&
    interior.spatial
  ) {
    const spatial = interior.spatial;
    if (
      spatial.draft.projectId === projectId &&
      spatial.baseline.projectId === projectId &&
      spatial.baseline.siteId === spatial.draft.siteId
    ) {
      const parsed = AgentViewContextSchema.safeParse({
        ...view,
        phase: "ready",
        siteId: spatial.draft.siteId,
        comparisonId: spatial.comparisonId,
        candidateIds: [spatial.draft.siteId],
        spatial,
      });
      if (parsed.success) return parsed.data;
    }
  }
  const query = new URLSearchParams(search);
  const one = (key: string) =>
    query.getAll(key).length === 1 ? query.get(key) || undefined : undefined;
  let selected = one("site");
  if (detail) {
    try {
      selected = decodeURIComponent(detail[1]);
    } catch {
      selected = undefined;
    }
  }
  const expected =
    view.stage === "simulator"
      ? "simulator"
      : view.stage === "plan"
        ? "plan"
        : view.stage === "replay"
          ? "replay"
          : view.stage === "comparison"
            ? "comparison"
            : "search";
  const observation = observations.find((entry) => entry.kind === expected);
  if (!observation) return view;
  view.phase = observation.phase;
  if (
    observation.phase === "example" ||
    observation.phase === "loading" ||
    ("synthetic" in observation && observation.synthetic)
  )
    return view;
  if (observation.phase === "missing" || observation.phase === "error")
    return view;
  const stored =
    view.stage === "replay"
      ? observations.find((entry) => entry.kind === "stored")
      : undefined;
  const artifact = stored?.kind === "stored" ? stored : observation;
  const comparisonValues = query.getAll("comparison");
  if (
    comparisonValues.length > 1 ||
    (comparisonValues.length === 1 &&
      (!comparisonValues[0] ||
        !("comparisonId" in artifact) ||
        artifact.comparisonId !== comparisonValues[0]))
  )
    return view;
  if (
    artifact.phase === "loading" ||
    artifact.phase === "example" ||
    ("synthetic" in artifact && artifact.synthetic)
  )
    return view;
  if ("comparisonId" in artifact && artifact.comparisonId)
    view.comparisonId = artifact.comparisonId;
  const candidates =
    "candidates" in artifact && artifact.candidates.length
      ? artifact.candidates
          .filter((entry) => !entry.synthetic)
          .map((entry) => entry.id)
      : "siteIds" in artifact
        ? artifact.siteIds
        : [];
  if (candidates.length)
    view.candidateIds = [...new Set(candidates)].slice(0, MAX_VIEW_CANDIDATES);
  if (
    "siteId" in observation &&
    (!stored || candidates.includes(observation.siteId ?? ""))
  )
    view.siteId = observation.siteId;
  else if (view.stage === "workspace" && observation.kind === "search") {
    const displayed =
      observation.candidates.find((candidate) => candidate.id === selected) ??
      observation.candidates[0];
    if (displayed && !displayed.synthetic) view.siteId = displayed.id;
  } else if (selected && candidates.includes(selected)) view.siteId = selected;
  if (view.stage === "workspace")
    Object.assign(view, workspaceFlowView(observations, view.candidateIds));
  const parsed = AgentViewContextSchema.safeParse(view);
  return parsed.success ? parsed.data : { stage: view.stage, ...flowStep };
}

/**
 * Scene 1: the listing facts for the displayed candidates (in `candidateIds` order, which is
 * the search's ranking), the comparison shortlist and the matching comparison, from the
 * workspace's comparison report.
 * Facts the listing lacks are left out, never guessed.
 */
export function workspaceFlowView(
  observations: readonly WorkspaceObservation[],
  candidateIds: readonly string[] | undefined,
): Pick<AgentViewContext, "candidates" | "shortlistIds" | "comparisonId"> {
  const comparison = observations.find((entry) => entry.kind === "comparison");
  if (!comparison || comparison.kind !== "comparison" || !candidateIds?.length)
    return {};
  const byId = new Map(
    comparison.candidates
      .filter((entry) => !entry.synthetic)
      .map((entry) => [entry.id, entry]),
  );
  const candidates = candidateIds.flatMap((id) => {
    const entry = byId.get(id);
    const address = entry?.address.trim().slice(0, 300);
    if (!entry || !address) return [];
    return [
      {
        id,
        address,
        ...(isFact(entry.monthlyRentUsd, 0)
          ? { monthlyRentUsd: entry.monthlyRentUsd }
          : {}),
        ...(isFact(entry.sqft, Number.MIN_VALUE) ? { sqft: entry.sqft } : {}),
        ...(isFact(entry.score, -Infinity) ? { score: entry.score } : {}),
      },
    ];
  });
  const shortlistIds = (comparison.shortlistIds ?? [])
    .filter((id) => candidateIds.includes(id))
    .slice(0, MAX_COMPARE_UNITS);
  return {
    ...(candidates.length
      ? { candidates: candidates.slice(0, MAX_VIEW_CANDIDATES) }
      : {}),
    ...(comparison.shortlistIds ? { shortlistIds } : {}),
    // The comparison on screen, only when it is for exactly the shortlist and its tweaks.
    ...(comparison.currentComparisonId
      ? { comparisonId: comparison.currentComparisonId }
      : {}),
  };
}

const isFact = (value: number | undefined, min: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min;
