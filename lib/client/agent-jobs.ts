"use client";

import { useSyncExternalStore } from "react";
import type { SpatialCommand } from "@/lib/contracts/spatial";
import type {
  FlowStep,
  HighlightTarget,
  UiAction,
} from "@/lib/contracts/agent";
import { MAX_COMPARE_UNITS, type SiteTweaks } from "@/lib/contracts/evaluation";
import {
  canOpenStep,
  reachStep,
  resetAfter,
  type FlowState,
} from "./flow-progress";
import { runAgentComparison } from "./live-comparison";
import { writeShortlist } from "./project-store";

/**
 * Scene 1: what the workspace does for the consultant's UI actions. `planWorkspaceActions`
 * turns one reply's actions into these effects (pure, so it is unit tested); the workspace
 * carries them out against the same comparison controller its screen renders.
 */
export type WorkspaceEffect =
  | {
      kind: "set_reference_cafe";
      expectedReference: {
        modelId: "qfmMbTLt4Bo";
        selectedPlan: 0 | 1;
        reviewed: boolean;
      } | null;
      siteId: string;
      comparisonId: string;
      draftId: string;
      expectedRevision: number;
      selectedPlan: 0 | 1;
      reviewed: boolean;
    }
  /** Emphasise these as the founder's top locations (numbered 1-3, best first). */
  | { kind: "present"; siteIds: string[] }
  /** Replace the comparison selection (at most MAX_COMPARE_UNITS). */
  | { kind: "select"; siteIds: string[] }
  /** Run the comparison for these units (they become the selection). */
  | { kind: "run"; siteIds: string[] }
  | { kind: "tweaks"; candidateId: string; tweaks: SiteTweaks }
  | { kind: "step"; step: FlowStep }
  | { kind: "highlight"; target: HighlightTarget }
  | { kind: "focus_map"; siteIds: string[] }
  | { kind: "open_site"; siteId: string }
  | { kind: "open_interior"; siteId: string }
  | {
      kind: "set_interior_affordability";
      siteId: string;
      comparisonId: string;
      draftId: string;
      expectedRevision: number;
      assessment: import("@/lib/contracts/interior-affordability").InteriorAffordabilityAssessment;
      accountId?: string;
    }
  | { kind:"propose_interior_experiment";siteId:string;comparisonId:string;draftId:string;expectedRevision:number;question:string;catalogId:string;position?:{x:number;z:number} }
  | {
      kind: "spatial_edit";
      siteId: string;
      command: SpatialCommand;
      comparisonId: string;
      draftId: string;
      expectedRevision: number;
    }
  | {
      kind: "run_spatial_experiment" | "review_interior";
      behavior?: "jev" | "assumed";
      siteId: string;
      comparisonId: string;
      draftId: string;
      expectedRevision: number;
    }
  | {
      kind: "finalize";
      comparisonId: string;
      chosenSiteId: string;
      rationale: string;
    };

export type WorkspaceActionState = {
  /** The live listings on screen, ranked best first. */
  candidateIds: readonly string[];
  selectedIds: readonly string[];
  flow: Pick<FlowState, "reached" | "siteTweaks" | "finalPlan">;
  /** Action ids already carried out (a replayed reply does nothing twice). */
  handled?: ReadonlySet<string>;
  /** The step on screen; moving to it again is a no-op. */
  step?: FlowStep;
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Plans one reply's actions in order. Unknown or synthetic site ids are dropped, selections
 * are capped at MAX_COMPARE_UNITS, `go_to_step` never opens a locked step (counting what
 * earlier actions in the same reply unlock), and navigate-away actions (`navigate`,
 * `show_comparison`, `open_simulator`, `open_interior`, `show_plan`) are ignored.
 */
export function planWorkspaceActions(
  actions: readonly UiAction[],
  state: WorkspaceActionState,
): WorkspaceEffect[] {
  const effects: WorkspaceEffect[] = [];
  const known = (ids: readonly string[]) =>
    [...new Set(ids)].filter((id) => state.candidateIds.includes(id));
  let selection = [...state.selectedIds];
  let flow = state.flow as FlowState;
  // A step change repeated in one reply (e.g. run_comparison then go_to_step compare), or to
  // the step already on screen, is emitted at most once.
  let onStep = state.step;
  const goTo = (step: FlowStep) => {
    if (step === onStep) return;
    effects.push({ kind: "step", step });
    onStep = step;
  };
  const select = (ids: string[]) => {
    if (sameSet(ids, selection)) return;
    effects.push({ kind: "select", siteIds: ids });
    selection = ids;
    flow = resetAfter(flow, "locations");
    if (ids.length >= 2) flow = reachStep(flow, "compare");
  };
  for (const action of actions) {
    if (state.handled?.has(action.id)) continue;
    switch (action.type) {
      case "present_top_sites": {
        const ids = known(action.siteIds).slice(0, MAX_COMPARE_UNITS);
        if (!ids.length) break;
        effects.push({ kind: "present", siteIds: ids });
        if (!selection.length) select(ids);
        break;
      }
      case "set_shortlist": {
        const ids = known(action.siteIds).slice(0, MAX_COMPARE_UNITS);
        if (ids.length) select(ids);
        break;
      }
      case "run_comparison": {
        const ids = known(action.siteIds).slice(0, MAX_COMPARE_UNITS);
        if (!ids.length) break;
        select(ids);
        // `compare` opens only for two or more units, exactly as the workspace unlocks it
        // (`select` above reaches it). A single unit runs where the founder is: sending them
        // to a locked step would only bounce them back to the locations.
        if (canOpenStep(flow, "compare")) goTo("compare");
        effects.push({ kind: "run", siteIds: ids });
        break;
      }
      case "set_site_tweaks":
        if (!state.candidateIds.includes(action.candidateId)) break;
        effects.push({
          kind: "tweaks",
          candidateId: action.candidateId,
          tweaks: action.tweaks,
        });
        flow = resetAfter(flow, "compare");
        break;
      case "go_to_step":
        if (canOpenStep(flow, action.step)) goTo(action.step);
        break;
      case "highlight":
        effects.push({ kind: "highlight", target: action.target });
        break;
      case "focus_map": {
        const ids = known(action.siteIds);
        if (ids.length) effects.push({ kind: "focus_map", siteIds: ids });
        break;
      }
      case "open_site":
        if (state.candidateIds.includes(action.siteId))
          effects.push({ kind: "open_site", siteId: action.siteId });
        break;
      case "open_interior":
        if (
          state.candidateIds.includes(action.siteId) &&
          canOpenStep(flow, "results")
        )
          effects.push({ kind: "open_interior", siteId: action.siteId });
        break;
      case "set_reference_cafe":
        if (
          state.candidateIds.includes(action.siteId) &&
          canOpenStep(flow, "interior")
        )
          effects.push({
            kind: "set_reference_cafe",
            expectedReference: action.expectedReference,
            siteId: action.siteId,
            comparisonId: action.comparisonId,
            draftId: action.draftId,
            expectedRevision: action.expectedRevision,
            selectedPlan: action.selectedPlan,
            reviewed: action.reviewed,
          });
        break;
      case "propose_interior_experiment":
        if(state.candidateIds.includes(action.siteId) && canOpenStep(flow,"interior")) {
          effects.push({kind:"propose_interior_experiment",siteId:action.siteId,comparisonId:action.comparisonId,draftId:action.draftId,expectedRevision:action.expectedRevision,question:action.question,catalogId:action.catalogId,...(action.position?{position:action.position}:{})});
        }
        break;
      case "spatial_edit":
      case "run_spatial_experiment":
      case "review_interior":
        if (
          state.candidateIds.includes(action.siteId) &&
          canOpenStep(flow, "interior")
        )
          effects.push(
            action.type === "spatial_edit"
              ? {
                  kind: action.type,
                  siteId: action.siteId,
                  command: action.command,
                  comparisonId: action.comparisonId,
                  draftId: action.draftId,
                  expectedRevision: action.expectedRevision,
                }
              : {
                  kind: action.type,
                  ...(action.type === "run_spatial_experiment" &&
                  action.behavior
                    ? { behavior: action.behavior }
                    : {}),
                  siteId: action.siteId,
                  comparisonId: action.comparisonId,
                  draftId: action.draftId,
                  expectedRevision: action.expectedRevision,
                },
          );
        break;
      case "set_interior_affordability":
        if (
          state.candidateIds.includes(action.siteId) &&
          canOpenStep(flow, "interior")
        )
          effects.push({
            kind: action.type,
            siteId: action.siteId,
            comparisonId: action.comparisonId,
            draftId: action.draftId,
            expectedRevision: action.expectedRevision,
            assessment: action.assessment,
            ...(action.accountId ? { accountId: action.accountId } : {}),
          });
        break;
      case "finalize_plan":
        effects.push({
          kind: "finalize",
          comparisonId: action.comparisonId,
          chosenSiteId: action.chosenSiteId,
          rationale: action.rationale,
        });
        flow = reachStep(flow, "finalize");
        // The finalize effect opens the step itself once the summary is stored.
        onStep = "finalize";
        break;
      default:
        // Navigate-away actions: the guided flow moves only through its own steps.
        break;
    }
  }
  return effects;
}

/**
 * HAC-151: the client half of the consultant's `jobs` tools. The server queues `set_shortlist`,
 * `run_comparison` and `show_comparison { investigationId }` actions on the intake reply; a
 * chat surface passes them here. Each step reports a progress message for the chat, and the
 * result says where to land. Idempotent by action `id`, so a replayed reply does nothing twice.
 */
export const investigationStorageKey = (projectId: string) =>
  `sitework:agent-investigation:v1:${projectId}`;
const CHANGE_EVENT = "sitework:agent-investigation";

export function readAgentInvestigation(
  storage: Pick<Storage, "getItem">,
  projectId: string,
): string | null {
  try {
    return storage.getItem(investigationStorageKey(projectId)) || null;
  } catch {
    return null;
  }
}

export function writeAgentInvestigation(projectId: string, id: string) {
  try {
    localStorage.setItem(investigationStorageKey(projectId), id);
  } catch {
    /* The feed then shows only for ?investigation= links. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The investigation the consultant started for this project; `undefined` before hydration. */
export function useAgentInvestigationId(projectId: string) {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(CHANGE_EVENT, onChange);
      };
    },
    () => readAgentInvestigation(localStorage, projectId) ?? undefined,
    () => undefined,
  );
}

export type AgentJobDeps = {
  projectId: string;
  /** Posts a progress message in the chat. */
  report(message: string): void;
  signal?: AbortSignal;
  runComparison?: typeof runAgentComparison;
  setShortlist?: (projectId: string, ids: string[]) => void;
  setInvestigation?: (projectId: string, id: string) => void;
};

const handled = new Set<string>();

/**
 * Applies the job actions in order. Returns the page to open (a path under the project) or
 * `null`; navigation is the caller's, as for other UI actions. A failed comparison reports
 * and stops the rest.
 */
export async function applyAgentJobActions(
  actions: readonly UiAction[],
  deps: AgentJobDeps,
): Promise<{ href: string | null }> {
  const base = `/projects/${encodeURIComponent(deps.projectId)}`;
  let href: string | null = null;
  for (const action of actions) {
    if (handled.has(action.id)) continue;
    if (action.type === "set_shortlist") {
      handled.add(action.id);
      (deps.setShortlist ?? writeShortlist)(deps.projectId, action.siteIds);
      deps.report(`Shortlisted ${action.siteIds.length} space(s).`);
    } else if (action.type === "run_comparison") {
      handled.add(action.id);
      deps.report(
        `Running the comparison of ${action.siteIds.length} space(s)…`,
      );
      try {
        await (deps.runComparison ?? runAgentComparison)(
          deps.projectId,
          action.siteIds,
          {
            signal: deps.signal,
            onProgress: ({ completedPersonas, totalPersonas }) =>
              deps.report(
                `Customer panel: ${completedPersonas} of ${totalPersonas} answered…`,
              ),
          },
        );
      } catch (error) {
        deps.report(
          `The comparison could not run: ${error instanceof Error ? error.message : "try again"}.`,
        );
        return { href };
      }
      deps.report("Comparison ready. Opening it.");
      href = `${base}/comparison`;
    } else if (action.type === "show_comparison" && action.investigationId) {
      handled.add(action.id);
      (deps.setInvestigation ?? writeAgentInvestigation)(
        deps.projectId,
        action.investigationId,
      );
      deps.report(
        "Investigation started. Follow its progress in the consultant panel.",
      );
      href = `${base}/comparison?investigation=${encodeURIComponent(action.investigationId)}`;
    }
  }
  return { href };
}
