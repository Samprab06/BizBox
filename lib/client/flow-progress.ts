"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  FLOW_STEP_IDS,
  FlowStepSchema,
  type FlowStep,
} from "@/lib/contracts/agent";
import {
  SiteTweakMapSchema,
  type SiteTweakMap,
  type SiteTweaks,
} from "@/lib/contracts/evaluation";
import {
  FinalPlanSummarySchema,
  type FinalPlanSummary,
} from "@/lib/contracts/plan";

/**
 * Scene 1: the guided flow's progress for one project, kept in localStorage so the top
 * stepper, the workspace and the consultant dock agree on where the founder is.
 *
 * The comparison itself and its shortlist stay in lib/client/project-store.ts; this store
 * only holds what the flow adds: which steps were reached, per-site tweaks for the next
 * run, and the finalized plan summary.
 */

export { FLOW_STEP_IDS, type FlowStep };

export const FLOW_STEPS: ReadonlyArray<{ id: FlowStep; label: string }> = [
  { id: "questions", label: "Your business" },
  { id: "locations", label: "Top locations" },
  { id: "compare", label: "Compare" },
  { id: "results", label: "Results & refine" },
  { id: "finalize", label: "Final plan" },
];

export const flowStepIndex = (step: FlowStep) => FLOW_STEP_IDS.indexOf(step);

/** `questions` is the questionnaire; every later step is a view of the workspace. */
export function flowStepHref(projectId: string, step: FlowStep): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return step === "questions"
    ? `${base}/intake`
    : `${base}/workspace?step=${step}`;
}

/** The step a URL shows: `/intake` is `questions`; `/workspace` reads `?step=`. */
export function flowStepFromLocation(
  pathname: string,
  search: string | URLSearchParams,
): FlowStep | null {
  if (/\/intake\/?$/.test(pathname)) return "questions";
  if (!/\/workspace\/?$/.test(pathname)) return null;
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const parsed = FlowStepSchema.safeParse(params.get("step"));
  return parsed.success && parsed.data !== "questions"
    ? parsed.data
    : "locations";
}

export const FlowStateSchema = z
  .object({
    /** Steps the founder has unlocked, in any order; `questions` is always reachable. */
    reached: z.array(FlowStepSchema).max(FLOW_STEP_IDS.length),
    siteTweaks: SiteTweakMapSchema,
    finalPlan: FinalPlanSummarySchema.nullable(),
  })
  .strict();
export type FlowState = z.infer<typeof FlowStateSchema>;

export const initialFlowState = (): FlowState => ({
  reached: ["questions"],
  siteTweaks: {},
  finalPlan: null,
});

/** Every step the stepper may open: those reached, plus `questions`, in flow order. */
export function reachableSteps(state: Pick<FlowState, "reached">): FlowStep[] {
  const reached = new Set<FlowStep>(["questions", ...state.reached]);
  return FLOW_STEP_IDS.filter((step) => reached.has(step));
}

export function canOpenStep(
  state: Pick<FlowState, "reached">,
  step: FlowStep,
): boolean {
  return reachableSteps(state).includes(step);
}

/**
 * Unlocks `step` and every step before it (reaching `results` implies `compare` was done).
 * Returns the same object when nothing changes.
 */
export function reachStep(state: FlowState, step: FlowStep): FlowState {
  const upTo = FLOW_STEP_IDS.slice(0, flowStepIndex(step) + 1);
  if (upTo.every((s) => state.reached.includes(s))) return state;
  const reached = FLOW_STEP_IDS.filter(
    (s) => upTo.includes(s) || state.reached.includes(s),
  );
  return { ...state, reached };
}

/**
 * Locks every step after `step` (e.g. a new shortlist invalidates results and the final
 * plan). Clears the final plan when `finalize` is locked.
 */
export function resetAfter(state: FlowState, step: FlowStep): FlowState {
  const keep = FLOW_STEP_IDS.slice(0, flowStepIndex(step) + 1);
  const reached = state.reached.filter((s) => keep.includes(s));
  const finalPlan = keep.includes("finalize") ? state.finalPlan : null;
  if (reached.length === state.reached.length && finalPlan === state.finalPlan)
    return state;
  return { ...state, reached, finalPlan };
}

export function withSiteTweaks(
  state: FlowState,
  candidateId: string,
  tweaks: SiteTweaks | null,
): FlowState {
  const siteTweaks: SiteTweakMap = { ...state.siteTweaks };
  if (tweaks && Object.keys(tweaks).length > 0)
    siteTweaks[candidateId] = tweaks;
  else delete siteTweaks[candidateId];
  return { ...state, siteTweaks };
}

export function withFinalPlan(
  state: FlowState,
  finalPlan: FinalPlanSummary | null,
): FlowState {
  const next = { ...state, finalPlan };
  return finalPlan ? reachStep(next, "finalize") : resetAfter(next, "results");
}

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
