/**
 * HAC-144 (AGT-17): the intake agent's `ui` tool group. Each tool checks its IDs against
 * trusted server data, queues one `UiAction` (lib/contracts/agent.ts) for the reply and
 * returns a short confirmation to the model. SDK-free, so the handler and tests import it
 * without loading deepagents; `runner.ts` wraps these specs as model tools.
 */
import { z } from "zod";
import {
  FocusMapActionSchema,
  HighlightActionSchema,
  MAX_UI_ACTIONS,
  NavigateActionSchema,
  OpenInteriorActionSchema,
  OpenSimulatorActionSchema,
  OpenSiteActionSchema,
  ShowComparisonActionSchema,
  ShowPlanActionSchema,
  UiActionSchema,
  type AgentViewContext,
  type UiAction,
} from "@/lib/contracts/agent";
import type { JobsPort } from "./job-tools";
import type { ComparisonResultsPort } from "./flow-tools";

/**
 * Trusted lookups. Each answers from server-side stores (the CoStar inventory, the
 * project's comparisons and investigations), never from the model or the request.
 */
export type IntakeUiLookups = {
  /** The site's city when the ID is in the inventory (`null` city if unrecorded), else null. */
  site(siteId: string): Promise<{ city: string | null } | null>;
  /** Whether this project owns a stored comparison with this ID. */
  comparisonExists(projectId: string, comparisonId: string): Promise<boolean>;
  /** Whether this project owns an investigation with this ID. */
  investigationExists(
    projectId: string,
    investigationId: string,
  ): Promise<boolean>;
};

/** Per-turn UI context the handler passes to the runner. `actions` is the turn's collector. */
export type IntakeUiContext = {
  projectId: string;
  lookups: IntakeUiLookups;
  view?: AgentViewContext;
  /** HAC-151: server-side job ports; binds the `jobs` tool group (lib/agent/job-tools.ts). */
  jobs?: JobsPort;
  /** Scene 1: reads this project's stored comparisons for the flow tools (flow-tools.ts). */
  results?: ComparisonResultsPort;
  /** Filled by the tools; the handler returns it even when the turn hits its step budget. */
  actions: UiAction[];
  newId: () => string;
};

const actionArgs = <T extends z.ZodObject>(schema: T) =>
  schema.omit({ id: true, type: true } as never) as unknown as z.ZodObject;

const SPECS = {
  show_step: {
    schema: actionArgs(NavigateActionSchema),
    description:
      "Move the founder's main view to a step: intake, workspace, map (candidate spaces), site, comparison, replay, simulator, plan or interior. Pass IDs only from the screen context or tool results.",
  },
  open_site: {
    schema: actionArgs(OpenSiteActionSchema),
    description:
      "Open one candidate space's property panel inside the workspace. siteId must come from the screen context or tool results.",
  },
  focus_map: {
    schema: actionArgs(FocusMapActionSchema),
    description: "Show the map framed on 1-8 candidate sites.",
  },
  show_comparison: {
    schema: actionArgs(ShowComparisonActionSchema),
    description:
      "Open the site comparison: a stored comparisonId, an investigationId, or neither for the current one.",
  },
  open_simulator: {
    schema: actionArgs(OpenSimulatorActionSchema),
    description:
      "Open the simulator for a stored comparison and/or one site.",
  },
  open_interior: {
    schema: actionArgs(OpenInteriorActionSchema),
    description:
      "Open a site's interior layout, optionally at a minute of the day (0-1439).",
  },
  show_plan: {
    schema: actionArgs(ShowPlanActionSchema),
    description: "Open the location plan for a stored comparison.",
  },
  highlight: {
    schema: actionArgs(HighlightActionSchema),
    description:
      "Point at one named element on the founder's current screen.",
  },
} as const;

export type UiToolName = keyof typeof SPECS;
export const UI_TOOL_NAMES = Object.keys(SPECS) as UiToolName[];
/**
 * Scene 1: the UI tools the guided-flow consultant is given. They act inside the workspace
 * (property panel, map framing, in-page highlights). The page jumps (show_step,
 * show_comparison, open_simulator, open_interior, show_plan) lead to legacy pages and are no
 * longer bound; the flow moves with go_to_step (flow-tools.ts) instead.
 */
export const FLOW_UI_TOOL_NAMES: readonly UiToolName[] = [
  "open_site",
  "focus_map",
  "highlight",
];

/** Model-facing tool definitions: name, description and JSON schema of the arguments. */
export const UI_TOOL_SPECS = UI_TOOL_NAMES.map((name) => {
  const schema = z.toJSONSchema(SPECS[name].schema) as Record<string, unknown>;
  delete schema.$schema;
  return { name, description: SPECS[name].description, schema };
});

const TYPE: Record<UiToolName, UiAction["type"]> = {
  show_step: "navigate",
  open_site: "open_site",
  focus_map: "focus_map",
  show_comparison: "show_comparison",
  open_simulator: "open_simulator",
  open_interior: "open_interior",
  show_plan: "show_plan",
  highlight: "highlight",
};

class Rejected extends Error {}

/** Short confirmation shown to the model; it never repeats unverified input. */
function describe(action: UiAction) {
  switch (action.type) {
    case "navigate":
      return `the ${action.stage} step`;
    case "open_site":
      return `site ${action.siteId}`;
    case "focus_map":
      return `the map on ${action.siteIds.length} site(s)`;
    case "show_comparison":
      return "the comparison";
    case "open_simulator":
      return "the simulator";
    case "open_interior":
      return `the interior of site ${action.siteId}`;
    case "show_plan":
      return "the location plan";
    case "highlight":
      return `the ${action.target} element`;
    case "set_shortlist":
      return `a shortlist of ${action.siteIds.length} site(s)`;
    case "run_comparison":
      return `a comparison of ${action.siteIds.length} site(s)`;
    case "present_top_sites":
      return `the top ${action.siteIds.length} location(s)`;
    case "set_site_tweaks":
      return `changes for site ${action.candidateId}`;
    case "go_to_step":
      return `the ${action.step} step`;
    case "finalize_plan":
      return "the finalized plan";
  }
}

/**
 * Executes UI tool calls for one turn. `draftCity` scopes sites to the founder's city: a
 * site from the other market is treated as foreign.
 */
export function createUiToolExecutor(
  context: IntakeUiContext,
  draftCity: () => string | undefined,
) {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const checkSite = async (siteId: string) => {
    const site = await once(`site:${siteId}`, () =>
      context.lookups.site(siteId),
    );
    if (!site) throw new Rejected(`Unknown site ID ${siteId}.`);
    const city = draftCity();
    // Case-insensitive, as site search compares cities (lib/data/sites.ts).
    if (
      city &&
      site.city?.trim() &&
      site.city.trim().toLowerCase() !== city.toLowerCase()
    )
      throw new Rejected(`Site ${siteId} is not in ${city}.`);
  };
  const checkComparison = async (comparisonId: string) => {
    const ok = await once(`cmp:${comparisonId}`, () =>
      context.lookups.comparisonExists(context.projectId, comparisonId),
    );
    if (!ok)
      throw new Rejected(
        `Comparison ${comparisonId} does not belong to this project.`,
      );
  };
  const checkInvestigation = async (investigationId: string) => {
    const ok = await once(`inv:${investigationId}`, () =>
      context.lookups.investigationExists(context.projectId, investigationId),
    );
    if (!ok)
      throw new Rejected(
        `Investigation ${investigationId} does not belong to this project.`,
      );
  };
  const verify = async (action: UiAction) => {
    const siteIds =
      action.type === "focus_map"
        ? action.siteIds
        : "siteId" in action && action.siteId
          ? [action.siteId]
          : [];
    for (const siteId of new Set(siteIds)) await checkSite(siteId);
    if ("comparisonId" in action && action.comparisonId)
      await checkComparison(action.comparisonId);
    if ("investigationId" in action && action.investigationId)
      await checkInvestigation(action.investigationId);
    if (action.type === "navigate") {
      if (action.stage === "site" && !action.siteId)
        throw new Rejected("The site step needs a siteId; use open_site.");
      if (action.stage === "interior" && !action.siteId)
        throw new Rejected("The interior step needs a siteId; use open_interior.");
    }
  };

  return async function run(name: UiToolName, rawArgs: unknown) {
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? rawArgs
        : {};
    const parsed = UiActionSchema.safeParse({
      ...args,
      id: context.newId(),
      type: TYPE[name],
    });
    if (!parsed.success)
      return `Error: invalid ${name} arguments (${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "args"} ${issue.message}`)
        .join("; ")}). Nothing was shown.`;
    const action = parsed.data;
    const key = JSON.stringify({ ...action, id: undefined });
    if (
      context.actions.some(
        (queued) => JSON.stringify({ ...queued, id: undefined }) === key,
      )
    )
      return `Already queued: ${describe(action)}.`;
    if (context.actions.length >= MAX_UI_ACTIONS)
      return `Error: UI action limit (${MAX_UI_ACTIONS}) reached for this turn. Do not call more UI tools; reply to the founder now.`;
    try {
      await verify(action);
    } catch (error) {
      if (error instanceof Rejected)
        return `Error: ${error.message} Nothing was shown. Use only IDs from the screen context or tool results.`;
      return "Error: that ID could not be verified right now. Nothing was shown; do not retry this turn.";
    }
    // Re-check after the await: a parallel call may have filled the turn's budget.
    if (context.actions.length >= MAX_UI_ACTIONS)
      return `Error: UI action limit (${MAX_UI_ACTIONS}) reached for this turn. Do not call more UI tools; reply to the founder now.`;
    context.actions.push(action);
    return `Queued: the founder's screen will show ${describe(action)}.`;
  };
}

/**
 * Rule-based fallback when no model runs the turn: the turn that completes the profile
 * moves the founder to the candidate spaces (the map step).
 */
export function ruleBasedUiActions(input: {
  wasComplete: boolean;
  isComplete: boolean;
  newId: () => string;
}): UiAction[] {
  return !input.wasComplete && input.isComplete
    ? [{ id: input.newId(), type: "navigate", stage: "map" }]
    : [];
}
