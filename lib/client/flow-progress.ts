"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { FinalPlanSummary } from "@/lib/contracts/plan";
import type { SiteTweaks } from "@/lib/contracts/evaluation";
import {
  initialFlowState,
  reachStep,
  reachableSteps,
  resetAfter,
  withFinalPlan,
  withSiteTweaks,
  FlowStateSchema,
  type FlowState,
  type FlowStep,
} from "./flow-steps";

/**
 * Scene 1: the guided flow's progress for one project, kept in localStorage so the top
 * stepper, the workspace and the consultant dock agree on where the founder is.
 *
 * The comparison itself and its shortlist stay in lib/client/project-store.ts; this store
 * only holds what the flow adds: which steps were reached, per-site tweaks for the next
 * run, and the finalized plan summary. Pure helpers live in ./flow-steps.ts.
 */

export * from "./flow-steps";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const flowStorageKey = (projectId: string) =>
  `bizbox:flow:v1:${projectId}`;

/** Same-tab writes don't fire `storage`, so the store announces them with this event. */
export const FLOW_UPDATED_EVENT = "bizbox:flow-updated";

/** When storage refuses a write, the state lives here until the page reloads. */
const memory = new Map<string, FlowState>();
/** Snapshot cache so useSyncExternalStore sees a stable object per stored value. */
const snapshots = new Map<string, { raw: string | null; state: FlowState }>();

export function parseFlowState(raw: string | null): FlowState {
  if (!raw) return initialFlowState();
  try {
    const parsed = FlowStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : initialFlowState();
  } catch {
    return initialFlowState();
  }
}

export function readFlowState(projectId: string): FlowState {
  const key = flowStorageKey(projectId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? initialFlowState();
  }
  if (raw === null && memory.has(key)) return memory.get(key)!;
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.state;
  const state = parseFlowState(raw);
  snapshots.set(key, { raw, state });
  return state;
}

export function writeFlowState(projectId: string, state: FlowState) {
  const key = flowStorageKey(projectId);
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(key, raw);
    memory.delete(key);
    snapshots.set(key, { raw, state });
  } catch {
    memory.set(key, state);
  }
  try {
    window.dispatchEvent(
      new CustomEvent(FLOW_UPDATED_EVENT, { detail: { projectId } }),
    );
  } catch {
    /* No window (tests): readers pick the state up on their next read. */
  }
}

/** Reads, transforms and writes the project's flow state in one step. */
export function updateFlowState(
  projectId: string,
  update: (state: FlowState) => FlowState,
): FlowState {
  const current = readFlowState(projectId);
  const next = update(current);
  if (next !== current) writeFlowState(projectId, next);
  return next;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(FLOW_UPDATED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(FLOW_UPDATED_EVENT, onChange);
  };
}

const SERVER_STATE = initialFlowState();

export type FlowProgress = {
  state: FlowState;
  reachable: FlowStep[];
  reach: (step: FlowStep) => void;
  resetAfter: (step: FlowStep) => void;
  setSiteTweaks: (candidateId: string, tweaks: SiteTweaks | null) => void;
  setFinalPlan: (plan: FinalPlanSummary | null) => void;
};

/** The project's flow state, kept in step across the stepper, workspace and dock. */
export function useFlowProgress(projectId: string): FlowProgress {
  const state = useSyncExternalStore(
    subscribe,
    () => readFlowState(projectId),
    () => SERVER_STATE,
  );
  const reach = useCallback(
    (step: FlowStep) => updateFlowState(projectId, (s) => reachStep(s, step)),
    [projectId],
  );
  const reset = useCallback(
    (step: FlowStep) => updateFlowState(projectId, (s) => resetAfter(s, step)),
    [projectId],
  );
  const setSiteTweaks = useCallback(
    (candidateId: string, tweaks: SiteTweaks | null) =>
      updateFlowState(projectId, (s) => withSiteTweaks(s, candidateId, tweaks)),
    [projectId],
  );
  const setFinalPlan = useCallback(
    (plan: FinalPlanSummary | null) =>
      updateFlowState(projectId, (s) => withFinalPlan(s, plan)),
    [projectId],
  );
  return useMemo(
    () => ({
      state,
      reachable: reachableSteps(state),
      reach,
      resetAfter: reset,
      setSiteTweaks,
      setFinalPlan,
    }),
    [state, reach, reset, setSiteTweaks, setFinalPlan],
  );
}
