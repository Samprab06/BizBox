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
import {
  copilotReducer,
  copilotStorageKey,
  initialCopilotState,
  restoreCopilotState,
  type ConfirmationCard,
  type CopilotState,
  type DiffCard,
} from "./controller";
import { unavailableCopilotRuntime } from "./runtime-adapter";
import {
  createScenarioApi,
  type ScenarioApi,
  type ScenarioSummary,
} from "./scenario-api";
import type { CopilotRuntimeAdapter, CopilotRuntimeStatus } from "./types";
import { viewContextFor } from "./view-context";

export type ScenarioTreeState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; scenarios: ScenarioSummary[] }
  | { state: "error"; message: string };

export type CopilotContextValue = {
  projectId: string;
  state: CopilotState;
  runtime: CopilotRuntimeStatus;
  scenarios: ScenarioTreeState;
  sendError: string | null;
  /** Sends a founder turn to the runtime with the current view context. */
  send: (text: string) => Promise<void>;
  keep: (card: DiffCard) => void;
  revert: (card: DiffCard) => Promise<void>;
  confirm: (card: ConfirmationCard, approved: boolean) => Promise<void>;
  setActiveScenario: (scenarioId: string | null) => void;
  setExpanded: (expanded: boolean) => void;
  reloadScenarios: () => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

/** The dock state for the current project; null outside a project layout. */
export function useCopilot() {
  return useContext(CopilotContext);
}

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * HAC-84: owns one copilot session per project. Mounted by the project layout, which
 * Next.js keeps mounted across client navigation, so the dock's cards, plan and
 * selections survive moving between pages. The same state is mirrored to
 * sessionStorage so a reload in the same tab restores it.
 */
export function CopilotProvider({
  projectId,
  adapter = unavailableCopilotRuntime,
  scenarioApi,
  children,
}: {
  projectId: string;
  adapter?: CopilotRuntimeAdapter;
  scenarioApi?: ScenarioApi;
  children: ReactNode;
}) {
  const api = useMemo(() => scenarioApi ?? createScenarioApi(), [scenarioApi]);
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState);
  const hydrated = useRef(false);
  const [loaded, setLoaded] = useState<{
    key: string;
    value: ScenarioTreeState;
  } | null>(null);
  const [scenarioRequest, setScenarioRequest] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const view = useRef({ pathname, search });
  const stateRef = useRef(state);
  useEffect(() => {
    view.current = { pathname, search };
    stateRef.current = state;
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

  useEffect(
    () =>
      adapter.subscribe(projectId, (event) =>
        dispatch({ type: "event", event }),
      ),
    [adapter, projectId],
  );

  // The tree loads only once the dock is open, so a collapsed dock makes no request.
  const requestKey = state.expanded ? `${projectId}:${scenarioRequest}` : null;
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    api
      .list(projectId, controller.signal)
      .then((list) =>
        setLoaded({
          key: requestKey,
          value: { state: "ready", scenarios: list },
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          key: requestKey,
          value: {
            state: "error",
            message: messageOf(error, "Scenarios are unavailable right now."),
          },
        });
      });
    return () => controller.abort();
  }, [api, projectId, requestKey]);
  const scenarios = useMemo<ScenarioTreeState>(
    () =>
      !requestKey
        ? { state: "idle" }
        : loaded?.key === requestKey
          ? loaded.value
          : { state: "loading" },
    [requestKey, loaded],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSendError(null);
      try {
        await adapter.send({
          text: trimmed,
          context: {
            projectId,
            view: viewContextFor(
              view.current.pathname,
              view.current.search,
              stateRef.current.activeScenarioId,
            ),
          },
        });
      } catch (error) {
        setSendError(messageOf(error, "The copilot didn't receive that."));
      }
    },
    [adapter, projectId],
  );

  const revert = useCallback(
    async (card: DiffCard) => {
      dispatch({ type: "revert_started", callId: card.callId });
      try {
        const reverted = await api.revert({
          projectId,
          scenarioId: card.scenarioId,
          targetId: card.parentId,
        });
        dispatch({
          type: "revert_succeeded",
          callId: card.callId,
          revertScenarioId: reverted.id,
        });
        setScenarioRequest((n) => n + 1);
      } catch (error) {
        dispatch({
          type: "revert_failed",
          callId: card.callId,
          message: messageOf(error, "The revert could not be saved."),
        });
      }
    },
    [api, projectId],
  );

  const confirm = useCallback(
    async (card: ConfirmationCard, approved: boolean) => {
      dispatch({ type: "confirmation_pending", scenarioId: card.scenarioId });
      try {
        await adapter.confirmRun({
          projectId,
          scenarioId: card.scenarioId,
          reason: card.reason,
          approved,
        });
        dispatch({
          type: "confirmation_resolved",
          scenarioId: card.scenarioId,
        });
      } catch (error) {
        dispatch({ type: "confirmation_failed", scenarioId: card.scenarioId });
        setSendError(messageOf(error, "Your answer wasn't sent."));
      }
    },
    [adapter, projectId],
  );

  const value = useMemo<CopilotContextValue>(
    () => ({
      projectId,
      state,
      runtime: adapter.status,
      scenarios,
      sendError,
      send,
      keep: (card) => dispatch({ type: "keep", callId: card.callId }),
      revert,
      confirm,
      setActiveScenario: (scenarioId) =>
        dispatch({ type: "set_active_scenario", scenarioId }),
      setExpanded: (expanded) => dispatch({ type: "set_expanded", expanded }),
      reloadScenarios: () => setScenarioRequest((n) => n + 1),
    }),
    [
      projectId,
      state,
      adapter.status,
      scenarios,
      sendError,
      send,
      revert,
      confirm,
    ],
  );

  return (
    <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>
  );
}
