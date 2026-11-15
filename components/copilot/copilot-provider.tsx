"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type {
  CopilotEvent,
  CopilotTurnRequest,
} from "@/lib/contracts/copilot-runtime";
import {
  copilotReducer,
  copilotStorageKey,
  initialCopilotState,
  restoreCopilotState,
  type CardAction,
  type ConfirmationCard,
  type CopilotState,
  type DiffCard,
} from "./controller";
import {
  COPILOT_UNAVAILABLE_MESSAGE,
  CopilotHttpError,
  createCopilotClient,
  type CopilotClient,
} from "./copilot-client";
import { copilotContextWithoutRevision, withRevision } from "./copilot-context";
import {
  createScenarioApi,
  type ScenarioApi,
  type ScenarioSummary,
} from "./scenario-api";

type Loadable<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error"; message: string; status: number | null };

export type ScenarioTreeState = Loadable<ScenarioSummary[]>;
export type RuntimeState = Loadable<true>;

export type CopilotContextValue = {
  projectId: string;
  state: CopilotState;
  /** Whether HAC-83's runtime answered; a 503 means it isn't set up yet. */
  runtime: RuntimeState;
  scenarios: ScenarioTreeState;
  busy: boolean;
  send: (text: string) => Promise<void>;
  act: (card: DiffCard, action: CardAction) => Promise<void>;
  confirm: (card: ConfirmationCard) => Promise<void>;
  resume: () => Promise<void>;
  retryRevertVersion: (card: DiffCard) => Promise<void>;
  setActiveScenario: (scenarioId: string | null) => void;
  setExpanded: (expanded: boolean) => void;
  dismissNotice: () => void;
  reload: () => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

/** The dock state for the current project; null outside a project layout. */
export function useCopilot() {
  return useContext(CopilotContext);
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const statusOf = (error: unknown) =>
  error instanceof CopilotHttpError ? error.status : null;

/** A load result counts only for the request it answered. */
function resolveLoadable<T>(
  requestKey: string | null,
  loaded: { key: string; value: Loadable<T> } | null,
): Loadable<T> {
  if (!requestKey) return { state: "idle" };
  return loaded?.key === requestKey ? loaded.value : { state: "loading" };
}

let requestCounter = 0;
const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${(requestCounter += 1)}`;

const ACTION_MESSAGE: Record<CardAction, (title: string) => string> = {
  run: (title) => `Run the proposed change: ${title}`,
  keep: (title) => `Keep the proposed change: ${title}`,
  revert: (title) => `Revert the proposed change: ${title}`,
};

/**
 * HAC-84: one copilot session per project, on HAC-83's runtime. Mounted by the project
 * layout, which Next.js keeps mounted across client navigation, so the dock's cards,
 * plan and selection survive moving between pages. The thread itself is durable on the
 * server; sessionStorage only restores the dock's own view in this tab.
 */
export function CopilotProvider({
  projectId,
  client,
  scenarioApi,
  children,
}: {
  projectId: string;
  client?: CopilotClient;
  scenarioApi?: ScenarioApi;
  children: ReactNode;
}) {
  const copilot = useMemo(() => client ?? createCopilotClient(), [client]);
  const api = useMemo(() => scenarioApi ?? createScenarioApi(), [scenarioApi]);
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState);
  const hydrated = useRef(false);
  const [loadedScenarios, setLoadedScenarios] = useState<{
    key: string;
    value: ScenarioTreeState;
  } | null>(null);
  const [loadedRuntime, setLoadedRuntime] = useState<{
    key: string;
    value: RuntimeState;
  } | null>(null);
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const latest = useRef({ pathname, search, state });
  const revisionFloor = useRef(0);
  useEffect(() => {
    latest.current = { pathname, search, state };
  });

  // Restore after mount so server and client markup match.
  useEffect(() => {
    let saved: CopilotState | null = null;
    try {
      saved = restoreCopilotState(
        sessionStorage.getItem(copilotStorageKey(projectId)),
      );
    } catch {
      saved = null;
    }
    hydrated.current = true;
    dispatch({ type: "hydrate", state: saved ?? initialCopilotState });
  }, [projectId]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(
        copilotStorageKey(projectId),
        JSON.stringify(state),
      );
    } catch {
      // Storage can be full or blocked; the in-memory dock still works.
    }
  }, [projectId, state]);

  const onEvent = useCallback(
    (event: CopilotEvent) => dispatch({ type: "event", event }),
    [],
  );

  // Nothing loads until the dock is opened, so a collapsed dock makes no request.
  const requestKey = state.expanded ? `${projectId}:${reloads}` : null;
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const settle =
      <T,>(
        set: (value: { key: string; value: Loadable<T> }) => void,
        fallback: string,
      ) =>
      (outcome: { value: T } | { error: unknown }) => {
        if (controller.signal.aborted) return;
        set({
          key: requestKey,
          value:
            "value" in outcome
              ? { state: "ready", value: outcome.value }
              : {
                  state: "error",
                  message: messageOf(outcome.error, fallback),
                  status: statusOf(outcome.error),
                },
        });
      };
    const runtimeDone = settle<true>(
      setLoadedRuntime,
      COPILOT_UNAVAILABLE_MESSAGE,
    );
    copilot
      .snapshot(projectId, controller.signal)
      .then((events) => {
        events.forEach(onEvent);
        runtimeDone({ value: true });
      })
      .catch((error: unknown) => runtimeDone({ error }));
    const scenariosDone = settle<ScenarioSummary[]>(
      setLoadedScenarios,
      "Scenarios are unavailable right now.",
    );
    api
      .list(projectId, controller.signal)
      .then((value) => scenariosDone({ value }))
      .catch((error: unknown) => scenariosDone({ error }));
    return () => controller.abort();
  }, [api, copilot, onEvent, projectId, requestKey]);

  const scenarios = useMemo(
    () => resolveLoadable(requestKey, loadedScenarios),
    [requestKey, loadedScenarios],
  );
  const runtimeLoaded = useMemo(
    () => resolveLoadable(requestKey, loadedRuntime),
    [requestKey, loadedRuntime],
  );
  // A turn that answered proves the runtime is up even if the snapshot failed.
  const [runtimeOverride, setRuntimeOverride] = useState<RuntimeState | null>(
    null,
  );
  const runtime = runtimeOverride ?? runtimeLoaded;

  const contextFor = useCallback(
    (scenarioId?: string) => {
      const current = latest.current;
      const context = withRevision(
        copilotContextWithoutRevision({
          projectId,
          pathname: current.pathname,
          search: current.search,
          scenarioId:
            scenarioId === undefined
              ? current.state.activeScenarioId
              : scenarioId,
        }),
        current.state.turn?.context ?? null,
        revisionFloor.current,
      );
      revisionFloor.current = Math.max(revisionFloor.current, context.revision);
      return context;
    },
    [projectId],
  );

  const stream = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setRuntimeOverride({ state: "ready", value: true });
      return true;
    } catch (error) {
      const message = messageOf(error, COPILOT_UNAVAILABLE_MESSAGE);
      dispatch({ type: "turn_failed", message });
      if (statusOf(error) === 503)
        setRuntimeOverride({ state: "error", message, status: 503 });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const startTurn = useCallback(
    (request: Omit<CopilotTurnRequest, "requestId">) =>
      stream(() =>
        copilot.start(
          projectId,
          { ...request, requestId: newRequestId() },
          onEvent,
        ),
      ),
    [copilot, onEvent, projectId, stream],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message) return;
      dispatch({
        type: "turn_requested",
        id: `local:${newRequestId()}`,
        text: message,
      });
      await startTurn({ message, context: contextFor() });
    },
    [contextFor, startTurn],
  );

  const saveRevertVersion = useCallback(
    async (card: DiffCard) => {
      if (!card.proposedScenarioId) return;
      try {
        const reverted = await api.revert({
          projectId,
          scenarioId: card.proposedScenarioId,
          targetId: card.baseScenarioId,
        });
        dispatch({
          type: "revert_version_saved",
          proposalId: card.proposalId,
          revertScenarioId: reverted.id,
        });
        setReloads((n) => n + 1);
      } catch (error) {
        dispatch({
          type: "revert_version_failed",
          proposalId: card.proposalId,
          message: messageOf(error, "The revert version could not be saved."),
        });
      }
    },
    [api, projectId],
  );

  const act = useCallback(
    async (card: DiffCard, action: CardAction, confirmBudget?: boolean) => {
      dispatch({ type: "card_action", proposalId: card.proposalId, action });
      // The runtime checks the action against the proposal's own base scenario.
      const ok = await startTurn({
        message: ACTION_MESSAGE[action](card.title),
        context: contextFor(card.baseScenarioId),
        proposalAction: {
          proposalId: card.proposalId,
          action,
          ...(action === "run" && confirmBudget ? { confirmBudget } : {}),
        },
      });
      if (!ok) {
        dispatch({
          type: "card_action_failed",
          proposalId: card.proposalId,
          message: "That decision wasn't saved. Try again.",
        });
        return;
      }
      if (action === "revert") await saveRevertVersion(card);
    },
    [contextFor, saveRevertVersion, startTurn],
  );

  const confirm = useCallback(
    async (confirmation: ConfirmationCard) => {
      const card = latest.current.state.cards.find(
        (c) => c.proposedScenarioId === confirmation.scenarioId,
      );
      if (!card) {
        dispatch({
          type: "turn_failed",
          message:
            "That run isn't linked to a proposal in this dock. Ask the copilot to propose it again.",
        });
        return;
      }
      await act(card, "run", confirmation.reason === "project_budget");
    },
    [act],
  );

  const resume = useCallback(async () => {
    const turn = latest.current.state.turn;
    if (!turn?.resumable) return;
    // Advance must resend the paused turn's exact context.
    await stream(() =>
      copilot.advance(projectId, turn.turnId, turn.context, onEvent),
    );
  }, [copilot, onEvent, projectId, stream]);

  // The provider re-renders only when its own state changes, so no extra memo.
  const value: CopilotContextValue = {
    projectId,
    state,
    runtime,
    scenarios,
    busy,
    send,
    act: (card, action) => act(card, action),
    confirm,
    resume,
    retryRevertVersion: saveRevertVersion,
    setActiveScenario: (scenarioId) =>
      dispatch({ type: "set_active_scenario", scenarioId }),
    setExpanded: (expanded) => dispatch({ type: "set_expanded", expanded }),
    dismissNotice: () => dispatch({ type: "dismiss_notice" }),
    reload: () => {
      setRuntimeOverride(null);
      setReloads((n) => n + 1);
    },
  };

  return (
    <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
  );
}
