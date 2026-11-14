import type { CopilotMutationToolName } from "@/lib/contracts/copilot-tools";
import type { CopilotRunResult } from "@/lib/contracts/copilot-run-tools";
import type { CopilotEvent, MetricDelta, PlanItem, Suggestion } from "./types";

/**
 * HAC-84: pure state for the copilot dock. The provider feeds it runtime events and the
 * founder's own actions; React only renders the result. Keeping it pure makes the
 * "exactly one diff card per mutation" rule testable without a browser.
 */

export type RunStatus =
  "not_run" | "queued" | "running" | "succeeded" | "failed";

export type DiffDecision =
  | { state: "proposed" }
  | { state: "kept" }
  | { state: "reverting" }
  | { state: "reverted"; revertScenarioId: string }
  | { state: "revert_failed"; message: string };

export type DiffCard = {
  /** The tool call that created the scenario; one card per call. */
  callId: string;
  tool: CopilotMutationToolName;
  scenarioId: string;
  parentId: string;
  label: string | null;
  rationale: string | null;
  sites: { added: string[]; removed: string[] };
  changedPaths: string[];
  run: RunStatus;
  executionId: string | null;
  comparisonId: string | null;
  metrics: MetricDelta[] | null;
  decision: DiffDecision;
};

export type ConfirmationCard = {
  scenarioId: string;
  reason: "human_run" | "project_budget";
  pending: boolean;
};

export type ActivityEntry = {
  id: string;
  tool: string;
  status: "running" | "done" | "failed";
  summary: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type CopilotState = {
  messages: ChatMessage[];
  plan: PlanItem[];
  activity: ActivityEntry[];
  cards: DiffCard[];
  confirmations: ConfirmationCard[];
  suggestions: Suggestion[];
  activeScenarioId: string | null;
  expanded: boolean;
};

export const initialCopilotState: CopilotState = {
  messages: [],
  plan: [],
  activity: [],
  cards: [],
  confirmations: [],
  suggestions: [],
  activeScenarioId: null,
  expanded: false,
};

/** Activity is a feed, not a log; older entries drop off. */
export const MAX_ACTIVITY = 50;
export const MAX_MESSAGES = 200;

export type CopilotAction =
  | { type: "event"; event: CopilotEvent }
  | { type: "keep"; callId: string }
  | { type: "revert_started"; callId: string }
  | { type: "revert_succeeded"; callId: string; revertScenarioId: string }
  | { type: "revert_failed"; callId: string; message: string }
  | { type: "confirmation_pending"; scenarioId: string }
  | { type: "confirmation_resolved"; scenarioId: string }
  | { type: "confirmation_failed"; scenarioId: string }
  | { type: "set_active_scenario"; scenarioId: string | null }
  | { type: "set_expanded"; expanded: boolean }
  | { type: "hydrate"; state: CopilotState };

export const TOOL_LABELS: Record<string, string> = {
  fork_scenario: "Created a what-if scenario",
  set_hours: "Changed opening hours",
  set_staffing: "Changed staffing",
  set_price: "Changed pricing",
  set_stations: "Changed station capacity",
  add_sites: "Added sites",
  remove_sites: "Removed sites",
  edit_layout: "Edited the layout",
  run_scenario: "Ran a scenario",
};

export const toolLabel = (tool: string) =>
  TOOL_LABELS[tool] ?? tool.replaceAll("_", " ");

function upsertActivity(
  activity: ActivityEntry[],
  entry: ActivityEntry,
): ActivityEntry[] {
  const index = activity.findIndex((a) => a.id === entry.id);
  const next =
    index === -1
      ? [...activity, entry]
      : activity.map((a, i) => (i === index ? { ...a, ...entry } : a));
  return next.slice(-MAX_ACTIVITY);
}

function updateCard(
  state: CopilotState,
  callId: string,
  change: (card: DiffCard) => DiffCard,
): CopilotState {
  if (!state.cards.some((card) => card.callId === callId)) return state;
  return {
    ...state,
    cards: state.cards.map((card) =>
      card.callId === callId ? change(card) : card,
    ),
  };
}

function applyRun(
  state: CopilotState,
  result: CopilotRunResult,
  metrics: MetricDelta[] | undefined,
): CopilotState {
  if (result.status === "rejected") return state;
  if (result.status === "needs_confirmation") {
    const others = state.confirmations.filter(
      (c) => c.scenarioId !== result.scenarioId,
    );
    return {
      ...state,
      confirmations: [
        ...others,
        {
          scenarioId: result.scenarioId,
          reason: result.reason,
          pending: false,
        },
      ],
    };
  }
  return {
    ...state,
    confirmations: state.confirmations.filter(
      (c) => c.scenarioId !== result.scenarioId,
    ),
    cards: state.cards.map((card) =>
      card.scenarioId === result.scenarioId
        ? {
            ...card,
            run: result.status,
            executionId: result.executionId,
            comparisonId: result.comparisonId ?? card.comparisonId,
            metrics:
              result.status === "succeeded" ? (metrics ?? card.metrics) : null,
          }
        : card,
    ),
  };
}

function applyEvent(state: CopilotState, event: CopilotEvent): CopilotState {
  switch (event.type) {
    case "message":
      if (state.messages.some((m) => m.id === event.id)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.id, role: event.role, text: event.text },
        ].slice(-MAX_MESSAGES),
      };
    case "plan":
      return { ...state, plan: event.items };
    case "suggestions":
      return { ...state, suggestions: event.items };
    case "tool_started":
      return {
        ...state,
        activity: upsertActivity(state.activity, {
          id: event.callId,
          tool: event.tool,
          status: "running",
          summary: null,
        }),
      };
    case "tool_finished":
      return {
        ...state,
        activity: upsertActivity(state.activity, {
          id: event.callId,
          tool: event.tool,
          status: event.ok ? "done" : "failed",
          summary: event.summary ?? null,
        }),
      };
    case "mutation": {
      const { result } = event;
      if (result.status !== "created") {
        // Nothing changed, so there is no card: the feed says why.
        return {
          ...state,
          activity: upsertActivity(state.activity, {
            id: event.callId,
            tool: event.tool,
            status: "failed",
            summary: result.message,
          }),
        };
      }
      const activity = upsertActivity(state.activity, {
        id: event.callId,
        tool: event.tool,
        status: "done",
        summary: null,
      });
      // Exactly one card per mutation: replayed or duplicated events are ignored.
      if (
        state.cards.some(
          (card) =>
            card.callId === event.callId ||
            card.scenarioId === result.scenarioId,
        )
      )
        return { ...state, activity };
      const card: DiffCard = {
        callId: event.callId,
        tool: event.tool,
        scenarioId: result.scenarioId,
        parentId: result.parentId,
        label: event.label ?? null,
        rationale: event.rationale ?? null,
        sites: result.diff.sites,
        changedPaths: result.diff.changedPaths,
        run: "not_run",
        executionId: null,
        comparisonId: null,
        metrics: null,
        decision: { state: "proposed" },
      };
      return { ...state, activity, cards: [...state.cards, card] };
    }
    case "run": {
      const { result } = event;
      const status =
        result.status === "rejected" || result.status === "failed"
          ? "failed"
          : result.status === "succeeded"
            ? "done"
            : "running";
      const summary =
        result.status === "rejected"
          ? result.message
          : result.status === "needs_confirmation"
            ? "Waiting for your confirmation"
            : null;
      return applyRun(
        {
          ...state,
          activity: upsertActivity(state.activity, {
            id: event.callId,
            tool: "run_scenario",
            status: result.status === "needs_confirmation" ? "done" : status,
            summary,
          }),
        },
        result,
        event.metrics,
      );
    }
  }
}

export function copilotReducer(
  state: CopilotState,
  action: CopilotAction,
): CopilotState {
  switch (action.type) {
    case "event":
      return applyEvent(state, action.event);
    case "keep": {
      const card = state.cards.find((c) => c.callId === action.callId);
      if (!card || card.decision.state === "reverted") return state;
      return {
        ...updateCard(state, action.callId, (c) => ({
          ...c,
          decision: { state: "kept" },
        })),
        activeScenarioId: card.scenarioId,
      };
    }
    case "revert_started":
      return updateCard(state, action.callId, (c) =>
        c.decision.state === "reverted" || c.decision.state === "reverting"
          ? c
          : { ...c, decision: { state: "reverting" } },
      );
    case "revert_succeeded": {
      const card = state.cards.find((c) => c.callId === action.callId);
      if (!card) return state;
      const next = updateCard(state, action.callId, (c) => ({
        ...c,
        decision: {
          state: "reverted",
          revertScenarioId: action.revertScenarioId,
        },
      }));
      // The revert version is now the scenario everyone works from.
      return {
        ...next,
        activeScenarioId:
          state.activeScenarioId === card.scenarioId ||
          state.activeScenarioId === null
            ? action.revertScenarioId
            : state.activeScenarioId,
      };
    }
    case "revert_failed":
      return updateCard(state, action.callId, (c) => ({
        ...c,
        decision: { state: "revert_failed", message: action.message },
      }));
    case "confirmation_pending":
    case "confirmation_failed":
      return {
        ...state,
        confirmations: state.confirmations.map((c) =>
          c.scenarioId === action.scenarioId
            ? { ...c, pending: action.type === "confirmation_pending" }
            : c,
        ),
      };
    case "confirmation_resolved":
      return {
        ...state,
        confirmations: state.confirmations.filter(
          (c) => c.scenarioId !== action.scenarioId,
        ),
      };
    case "set_active_scenario":
      return { ...state, activeScenarioId: action.scenarioId };
    case "set_expanded":
      return { ...state, expanded: action.expanded };
    case "hydrate":
      return action.state;
  }
}

/* ---- persistence ---------------------------------------------------------- */

export const copilotStorageKey = (projectId: string) =>
  `bizbox:copilot:v1:${projectId}`;

/** Restores a saved dock, dropping anything that was mid-flight when it was saved. */
export function restoreCopilotState(raw: string | null): CopilotState | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<CopilotState>;
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.cards))
      return null;
    return {
      ...initialCopilotState,
      ...saved,
      messages: Array.isArray(saved.messages) ? saved.messages : [],
      plan: Array.isArray(saved.plan) ? saved.plan : [],
      activity: Array.isArray(saved.activity) ? saved.activity : [],
      suggestions: Array.isArray(saved.suggestions) ? saved.suggestions : [],
      cards: saved.cards.map((card) =>
        card.decision?.state === "reverting"
          ? { ...card, decision: { state: "proposed" } }
          : card,
      ),
      confirmations: Array.isArray(saved.confirmations)
        ? saved.confirmations.map((c) => ({ ...c, pending: false }))
        : [],
      activeScenarioId:
        typeof saved.activeScenarioId === "string"
          ? saved.activeScenarioId
          : null,
      expanded: saved.expanded === true,
    };
  } catch {
    return null;
  }
}

/* ---- presentation helpers ------------------------------------------------- */

const PATH_LABELS: Record<string, string> = {
  "hours.weekday.openMinute": "Weekday opening time",
  "hours.weekday.closeMinute": "Weekday closing time",
  "hours.weekend.openMinute": "Weekend opening time",
  "hours.weekend.closeMinute": "Weekend closing time",
  staffHeadcount: "Staff headcount",
  averageTicketCents: "Average ticket",
  priceTier: "Price tier",
  plannedStations: "Stations",
  demandMultiplier: "Demand multiplier",
  seedSet: "Simulation seeds",
  siteIds: "Sites",
  layoutId: "Layout",
  label: "Label",
};

export function changedPathLabel(path: string): string {
  const key = path.replace(/^overrides\./, "");
  return PATH_LABELS[key] ?? key;
}

/** "+3.5 min", "−12 customers/day", or null when either side is unknown. */
export function formatDelta(metric: MetricDelta): string | null {
  if (metric.before === null || metric.after === null) return null;
  const delta = metric.after - metric.before;
  const rounded = Math.round(delta * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US")} ${metric.unit}`.trim();
}

export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  not_run: "Not run yet",
  queued: "Run queued",
  running: "Running",
  succeeded: "Run finished",
  failed: "Run failed",
};
