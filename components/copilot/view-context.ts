import {
  AgentStageSchema,
  AgentViewContextSchema,
  type AgentViewContext,
} from "@/lib/contracts/agent";

/**
 * HAC-84: the HAC-134 view context for the page the dock is on, so a typed or spoken turn
 * from the dock tells the runtime the same site/comparison/scenario every page shares.
 * Unknown or malformed values are dropped rather than sent.
 */
export function viewContextFor(
  pathname: string,
  search: string,
  activeScenarioId: string | null,
): AgentViewContext {
  const segments = pathname.split("/").filter(Boolean);
  // /projects/<id>/<route>[/<siteId>]
  const route = segments[2] === "sites" ? "site" : segments[2];
  const stage = AgentStageSchema.safeParse(route);
  const query = new URLSearchParams(search);
  const decode = (value: string | undefined) => {
    try {
      return value ? decodeURIComponent(value) : undefined;
    } catch {
      return undefined;
    }
  };
  const candidate = {
    stage: stage.success ? stage.data : "workspace",
    siteId:
      (route === "site" && segments[3] !== "unselected"
        ? decode(segments[3])
        : undefined) ??
      query.get("site") ??
      undefined,
    comparisonId: query.get("comparison") ?? undefined,
    scenarioId: activeScenarioId ?? undefined,
  };
  const clean = Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        value !== undefined &&
        (key === "stage" ||
          AgentViewContextSchema.shape[
            key as keyof typeof AgentViewContextSchema.shape
          ].safeParse(value).success),
    ),
  );
  return AgentViewContextSchema.parse(clean);
}
