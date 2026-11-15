import {
  CopilotContextSchema,
  type CopilotContext,
} from "@/lib/contracts/copilot-runtime";

/**
 * HAC-84: the HAC-83 context snapshot for the page the dock is on, so every turn and
 * every Keep/Revert/Run carries the same project/site/scenario the pages share.
 * Malformed values are dropped rather than sent.
 */

const VIEW_FOR_ROUTE: Record<string, CopilotContext["view"]> = {
  intake: "intake",
  workspace: "city",
  map: "city",
  sites: "space",
  comparison: "comparison",
  replay: "city",
  simulator: "city",
  plan: "plan",
  interior: "interior",
};

export type CopilotContextInput = {
  projectId: string;
  pathname: string;
  search: string;
  scenarioId: string | null;
};

export function copilotContextWithoutRevision({
  projectId,
  pathname,
  search,
  scenarioId,
}: CopilotContextInput): Omit<CopilotContext, "revision"> {
  const segments = pathname.split("/").filter(Boolean);
  // /projects/<id>/<route>[/<siteId>]
  const route = segments[2] ?? "workspace";
  const query = new URLSearchParams(search);
  const decode = (value: string | undefined) => {
    try {
      return value ? decodeURIComponent(value) : undefined;
    } catch {
      return undefined;
    }
  };
  const fromPath =
    route === "sites" && segments[3] !== "unselected"
      ? decode(segments[3])
      : undefined;
  const optional = {
    siteId: fromPath ?? query.get("site") ?? undefined,
    scenarioId: scenarioId ?? undefined,
  };
  const shape = CopilotContextSchema.shape;
  const page = `${pathname}${search ? `?${search}` : ""}`.slice(0, 500);
  return {
    projectId,
    page: page || "/",
    view: VIEW_FOR_ROUTE[route] ?? "city",
    ...Object.fromEntries(
      Object.entries(optional).filter(
        ([key, value]) =>
          value !== undefined &&
          shape[key as keyof typeof optional].safeParse(value).success,
      ),
    ),
  };
}

const sameSelection = (
  a: Omit<CopilotContext, "revision">,
  b: Omit<CopilotContext, "revision">,
) =>
  (Object.keys(CopilotContextSchema.shape) as (keyof CopilotContext)[])
    .filter((key) => key !== "revision")
    .every((key) => a[key] === b[key]);

/**
 * The runtime rejects a context that differs from the last turn's under the same
 * revision, so reuse the revision only for an identical selection and bump it otherwise.
 * `floor` is the highest revision this tab has sent.
 */
export function withRevision(
  candidate: Omit<CopilotContext, "revision">,
  last: CopilotContext | null,
  floor: number,
): CopilotContext {
  const revision =
    last && sameSelection(candidate, last)
      ? last.revision
      : Math.max(last?.revision ?? 0, floor) + 1;
  return CopilotContextSchema.parse({ ...candidate, revision });
}
