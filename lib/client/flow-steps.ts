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
 * Scene 1: the guided flow's steps and pure state transitions. No React and no storage, so
 * server components (e.g. redirects) can build step URLs. The localStorage-backed store and
 * the `useFlowProgress` hook live in ./flow-progress.ts, which re-exports all of this.
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
