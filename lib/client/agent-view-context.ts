import {
  AgentStageSchema,
  AgentViewContextSchema,
  MAX_VIEW_CANDIDATES,
  type AgentViewContext,
} from "@/lib/contracts/agent";
import { reportsForRoute, type WorkspaceReport } from "./workspace-context";

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
  const view: AgentViewContext = {
    stage: stage.success ? stage.data : "workspace",
  };
  const observations = reportsForRoute(
    reports,
    projectId,
    `${pathname}?${search}`,
  );
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
  const parsed = AgentViewContextSchema.safeParse(view);
  return parsed.success ? parsed.data : { stage: view.stage };
}
