"use client";

import { useSyncExternalStore } from "react";
import type { UiAction } from "@/lib/contracts/agent";
import { runAgentComparison } from "./live-comparison";
import { writeShortlist } from "./project-store";

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
      deps.report(`Running the comparison of ${action.siteIds.length} space(s)…`);
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
      deps.report("Investigation started. Follow its progress in the consultant panel.");
      href = `${base}/comparison?investigation=${encodeURIComponent(action.investigationId)}`;
    }
  }
  return { href };
}
