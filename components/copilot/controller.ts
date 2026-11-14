import {
  CopilotMutationResultSchema,
  type CopilotMutationToolName,
} from "@/lib/contracts/copilot-tools";
import { CopilotRunResultSchema } from "@/lib/contracts/copilot-run-tools";
import type {
  CopilotContext,
  CopilotEvent,
  CopilotProposal,
  CopilotSourceLabel,
  CopilotTodo,
} from "@/lib/contracts/copilot-runtime";

/**
 * HAC-84 (AGT-5): pure state for the copilot dock, built on HAC-83's event contract
 * (lib/contracts/copilot-runtime.ts). The provider feeds it streamed and replayed events
 * plus the founder's own actions; React only renders the result. Keeping it pure makes
 * "exactly one diff card per agent mutation" testable without a browser.
 */

export type RunStatus =
  | "not_run"
  | "awaiting_confirmation"
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type CardAction = "run" | "keep" | "revert";

export type DiffCard = {
  /** The runtime's proposal id, which is also the mutation's tool call id. */
  proposalId: string;
  tool: string | null;
  title: string;
  description: string;
  baseScenarioId: string;
  proposedScenarioId: string | null;
  sites: { added: string[]; removed: string[] };
  changedPaths: string[];
  /** Server-side decision, as the runtime last reported it. */
  status: CopilotProposal["status"];
  run: RunStatus;
  comparisonId: string | null;
  /** An action the founder started that the runtime hasn't confirmed yet. */
  pending: CardAction | null;
  error: string | null;
  /** The new scenario version Revert saved (HAC-80 revert-to). */
  revertScenarioId: string | null;
  /** The runtime recorded the revert, but saving the revert version failed. */
  revertVersionFailed: boolean;
};

export type ConfirmationCard = {
  scenarioId: string;
  reason: "human_run" | "project_budget";
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
  sources: CopilotSourceLabel[];
};

export type TurnState = {
  turnId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  context: CopilotContext;
  /** The runtime stopped at a limit and said the turn can continue. */
  resumable: boolean;
};

type MutationDiff = {
  tool: string;
  sites: { added: string[]; removed: string[] };
  changedPaths: string[];
};

export type CopilotState = {
  messages: ChatMessage[];
  plan: CopilotTodo[];
  activity: ActivityEntry[];
  cards: DiffCard[];
  confirmations: ConfirmationCard[];
  /** Highest event sequence applied per turn; replays are skipped. */
  seen: Record<string, number>;
  /** Mutation results waiting for their proposal event, by call id. */
  diffs: Record<string, MutationDiff>;
  turn: TurnState | null;
  notice: { tone: "info" | "error"; text: string } | null;
  activeScenarioId: string | null;
  expanded: boolean;
};

export const initialCopilotState: CopilotState = {
  messages: [],
  plan: [],
  activity: [],
  cards: [],
  confirmations: [],
  seen: {},
  diffs: {},
  turn: null,
  notice: null,
  activeScenarioId: null,
  expanded: false,
};

/** Activity is a feed, not a log; older entries drop off. */
export const MAX_ACTIVITY = 50;
export const MAX_MESSAGES = 200;
const MAX_DIFFS = 50;

export type CopilotAction =
  | { type: "event"; event: CopilotEvent }
  | { type: "turn_requested"; id: string; text: string }
  | { type: "turn_failed"; message: string }
  | { type: "card_action"; proposalId: string; action: CardAction }
  | { type: "card_action_failed"; proposalId: string; message: string }
  | {
      type: "revert_version_saved";
      proposalId: string;
      revertScenarioId: string;
    }
  | { type: "revert_version_failed"; proposalId: string; message: string }
  | { type: "set_active_scenario"; scenarioId: string | null }
  | { type: "set_expanded"; expanded: boolean }
  | { type: "dismiss_notice" }
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

const MUTATION_TOOLS = new Set<string>([
  "fork_scenario",
  "set_hours",
  "set_staffing",
  "set_price",
  "set_stations",
  "add_sites",
  "remove_sites",
  "edit_layout",
] satisfies CopilotMutationToolName[]);

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
  proposalId: string,
  change: (card: DiffCard) => DiffCard,
): CopilotState {
  if (!state.cards.some((card) => card.proposalId === proposalId)) return state;
  return {
    ...state,
    cards: state.cards.map((card) =>
      card.proposalId === proposalId ? change(card) : card,
    ),
  };
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function applyToolResult(
  state: CopilotState,
  event: Extract<CopilotEvent, { type: "tool_completed" }>,
): CopilotState {
  const done = (summary: string | null, ok = true) =>
    upsertActivity(state.activity, {
      id: event.callId,
      tool: event.tool,
      status: ok ? "done" : "failed",
      summary,
    });

  if (MUTATION_TOOLS.has(event.tool)) {
    const parsed = CopilotMutationResultSchema.safeParse(event.result);
    if (!parsed.success) return { ...state, activity: done(null) };
    const result = parsed.data;
    if (result.status !== "created")
      // Nothing changed, so there is no card: the feed says why.
      return { ...state, activity: done(result.message, false) };
    const entries = Object.entries({
      ...state.diffs,
      [event.callId]: {
        tool: event.tool,
        sites: result.diff.sites,
        changedPaths: result.diff.changedPaths,
      },
    }).slice(-MAX_DIFFS);
    // A proposal that arrived first picks up its diff now.
    const next = updateCard(state, event.callId, (card) => ({
      ...card,
      tool: event.tool,
      sites: result.diff.sites,
      changedPaths: result.diff.changedPaths,
    }));
    return {
      ...next,
      activity: done(null),
      diffs: Object.fromEntries(entries),
    };
  }

  if (event.tool === "run_scenario") {
    const parsed = CopilotRunResultSchema.safeParse(event.result);
    if (!parsed.success) return { ...state, activity: done(null) };
    const result = parsed.data;
    if (result.status === "rejected")
      return { ...state, activity: done(result.message, false) };
    if (result.status === "needs_confirmation") {
      const confirmations = [
        ...state.confirmations.filter(
          (c) => c.scenarioId !== result.scenarioId,
        ),
        { scenarioId: result.scenarioId, reason: result.reason },
      ];
      return {
        ...state,
        activity: done("Waiting for your confirmation"),
        confirmations,
        cards: state.cards.map((card) =>
          card.proposedScenarioId === result.scenarioId
            ? { ...card, run: "awaiting_confirmation" }
            : card,
        ),
      };
    }
    return {
      ...state,
      activity: done(null, result.status !== "failed"),
      confirmations: state.confirmations.filter(
        (c) => c.scenarioId !== result.scenarioId,
      ),
      cards: state.cards.map((card) =>
        card.proposedScenarioId === result.scenarioId
          ? {
              ...card,
              run: result.status,
              comparisonId: result.comparisonId ?? card.comparisonId,
            }
          : card,
      ),
    };
  }

  return { ...state, activity: done(null) };
}

function applyProposal(
  state: CopilotState,
  proposal: CopilotProposal,
): CopilotState {
  const existing = state.cards.find((c) => c.proposalId === proposal.id);
  if (existing)
    // Exactly one card per mutation: later events only update its status.
    return updateCard(state, proposal.id, (card) => ({
      ...card,
      status: proposal.status,
      proposedScenarioId:
        proposal.proposedScenarioId ?? card.proposedScenarioId,
      pending:
        card.pending && proposal.status !== card.status ? null : card.pending,
    }));
  const diff = state.diffs[proposal.id];
  const card: DiffCard = {
    proposalId: proposal.id,
    tool: diff?.tool ?? null,
    title: diff ? toolLabel(diff.tool) : proposal.title,
    description: proposal.description,
    baseScenarioId: proposal.baseScenarioId,
    proposedScenarioId: proposal.proposedScenarioId ?? null,
    sites: diff?.sites ?? { added: [], removed: [] },
    changedPaths: diff?.changedPaths ?? [],
    status: proposal.status,
    run: proposal.status === "run_requested" ? "queued" : "not_run",
    comparisonId: null,
    pending: null,
    error: null,
    revertScenarioId: null,
    revertVersionFailed: false,
  };
  return {
    ...state,
    cards: [...state.cards, card],
    diffs: withoutKey(state.diffs, proposal.id),
  };
}

function appendAssistant(
  state: CopilotState,
  event: Extract<CopilotEvent, { type: "assistant_delta" }>,
): CopilotState {
  const id = `assistant:${event.turnId}`;
  const last = state.messages.at(-1);
  if (last?.id === id)
    return {
      ...state,
      messages: [
        ...state.messages.slice(0, -1),
        {
          ...last,
          text: last.text + event.text,
          sources: mergeSources(last.sources, event.sources),
        },
      ],
    };
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id,
        role: "assistant" as const,
        text: event.text,
        sources: event.sources,
      },
    ].slice(-MAX_MESSAGES),
  };
}

function mergeSources(a: CopilotSourceLabel[], b: CopilotSourceLabel[]) {
  const out = [...a];
  for (const source of b)
    if (!out.some((s) => s.kind === source.kind && s.label === source.label))
      out.push(source);
  return out;
}

function applyEvent(state: CopilotState, event: CopilotEvent): CopilotState {
  const last = state.seen[event.turnId];
  if (last !== undefined && event.sequence <= last) return state;
  const next: CopilotState = {
    ...state,
    seen: { ...state.seen, [event.turnId]: event.sequence },
  };
  const turn = (status: TurnState["status"], resumable = false): TurnState => ({
    turnId: event.turnId,
    status,
    context: event.context,
    resumable,
  });
  switch (event.type) {
    case "turn_started":
      return { ...next, turn: turn("running"), notice: null };
    case "assistant_delta":
      return appendAssistant(next, event);
    case "todos":
      return { ...next, plan: event.todos };
    case "tool_started":
      return {
        ...next,
        activity: upsertActivity(next.activity, {
          id: event.callId,
          tool: event.tool,
          status: "running",
          summary: null,
        }),
      };
    case "tool_completed":
      return applyToolResult(next, event);
    case "proposal":
      return applyProposal(next, event.proposal);
    case "ui":
      // Navigation requests are HAC-134/HAC-143's to act on; the dock only records them.
      return next;
    case "limit":
      return {
        ...next,
        turn: turn("paused", event.resumable),
        notice: { tone: "info", text: event.message },
      };
    case "turn_finished":
      return {
        ...next,
        // A paused turn stopped at a resumable limit (the runtime's "interrupted").
        turn: turn(event.status, event.status === "paused"),
        notice:
          event.status === "completed"
            ? next.notice
            : {
                tone: event.status === "failed" ? "error" : "info",
                text: event.message,
              },
        cards: next.cards.map((card) =>
          card.pending ? { ...card, pending: null } : card,
        ),
      };
    case "error":
      return {
        ...next,
        turn: next.turn
          ? { ...next.turn, status: "failed", resumable: false }
          : null,
        notice: { tone: "error", text: event.message },
        cards: next.cards.map((card) =>
          card.pending ? { ...card, pending: null } : card,
        ),
      };
  }
}

export function copilotReducer(
  state: CopilotState,
  action: CopilotAction,
): CopilotState {
  switch (action.type) {
    case "event":
      return applyEvent(state, action.event);
    case "turn_requested":
      return {
        ...state,
        notice: null,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "user" as const,
            text: action.text,
            sources: [],
          },
        ].slice(-MAX_MESSAGES),
      };
    case "turn_failed":
      return {
        ...state,
        notice: { tone: "error", text: action.message },
        cards: state.cards.map((card) =>
          card.pending ? { ...card, pending: null } : card,
        ),
      };
    case "card_action": {
      const card = state.cards.find((c) => c.proposalId === action.proposalId);
      if (!card || card.pending || !cardActions(card).includes(action.action))
        return state;
      const next = updateCard(state, action.proposalId, (c) => ({
        ...c,
        pending: action.action,
        error: null,
      }));
      return action.action === "keep" && card.proposedScenarioId
        ? { ...next, activeScenarioId: card.proposedScenarioId }
        : next;
    }
    case "card_action_failed":
      return updateCard(state, action.proposalId, (c) => ({
        ...c,
        pending: null,
        error: action.message,
      }));
    case "revert_version_saved": {
      const card = state.cards.find((c) => c.proposalId === action.proposalId);
      if (!card) return state;
      const next = updateCard(state, action.proposalId, (c) => ({
        ...c,
        status: "reverted",
        revertScenarioId: action.revertScenarioId,
        revertVersionFailed: false,
        error: null,
      }));
      // The revert version is now the scenario everyone works from.
      return {
        ...next,
        activeScenarioId:
          state.activeScenarioId === null ||
          state.activeScenarioId === card.proposedScenarioId
            ? action.revertScenarioId
            : state.activeScenarioId,
      };
    }
    case "revert_version_failed":
      return updateCard(state, action.proposalId, (c) => ({
        ...c,
        status: "reverted",
        pending: null,
        revertVersionFailed: true,
        error: action.message,
      }));
    case "set_active_scenario":
      return { ...state, activeScenarioId: action.scenarioId };
    case "set_expanded":
      return { ...state, expanded: action.expanded };
    case "dismiss_notice":
      return { ...state, notice: null };
    case "hydrate":
      return action.state;
  }
}

/** The decisions a card still offers. Run is always an explicit human choice. */
export function cardActions(card: DiffCard): CardAction[] {
  if (card.status === "reverted" || card.status === "kept") return [];
  const actions: CardAction[] = ["keep", "revert"];
  if (
    card.proposedScenarioId &&
    (card.run === "not_run" ||
      card.run === "failed" ||
      card.run === "awaiting_confirmation")
  )
    actions.unshift("run");
  return actions;
}

/* ---- persistence ---------------------------------------------------------- */

export const copilotStorageKey = (projectId: string) =>
  `bizbox:copilot:v2:${projectId}`;

/** Restores a saved dock, dropping anything that was mid-flight when it was saved. */
export function restoreCopilotState(raw: string | null): CopilotState | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<CopilotState>;
    if (!saved || typeof saved !== "object" || !Array.isArray(saved.cards))
      return null;
    const list = <T>(value: T[] | undefined) =>
      Array.isArray(value) ? value : [];
    return {
      ...initialCopilotState,
      messages: list(saved.messages),
      plan: list(saved.plan),
      activity: list(saved.activity),
      cards: saved.cards.map((card) => ({ ...card, pending: null })),
      confirmations: list(saved.confirmations),
      seen: saved.seen && typeof saved.seen === "object" ? saved.seen : {},
      diffs: saved.diffs && typeof saved.diffs === "object" ? saved.diffs : {},
      turn: saved.turn ?? null,
      notice: null,
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

export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  not_run: "Not run yet",
  awaiting_confirmation: "Waiting for your confirmation",
  queued: "Run requested",
  running: "Running",
  succeeded: "Run finished",
  failed: "Run failed",
};
