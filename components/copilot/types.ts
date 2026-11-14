import type {
  CopilotMutationResult,
  CopilotMutationToolName,
} from "@/lib/contracts/copilot-tools";
import type { CopilotRunResult } from "@/lib/contracts/copilot-run-tools";

/**
 * HAC-84 (AGT-5): the narrow interface the copilot dock consumes.
 *
 * Tool results reuse the existing shared contracts (`CopilotMutationResult`,
 * `CopilotRunResult`). The event envelope and the adapter are local to the dock on
 * purpose: HAC-83 (Copilot runtime) owns the real conversation/event contract, and its
 * adapter only has to translate that stream into these events. Nothing here is a shared
 * contract, so changing it needs no migration.
 */

export type PlanItemStatus = "pending" | "in_progress" | "done" | "failed";

export type PlanItem = { id: string; label: string; status: PlanItemStatus };

/** A finished run's headline numbers for one scenario against its parent. */
export type MetricDelta = {
  key: string;
  label: string;
  /** Display unit, for example "min", "customers/day" or "%". */
  unit: string;
  before: number | null;
  after: number | null;
  /** Where the number came from (costar, public, founder, default, or simulation). */
  origin: string;
};

export type Suggestion = { id: string; label: string; prompt: string };

export type CopilotEvent =
  | {
      type: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
    }
  | { type: "plan"; items: PlanItem[] }
  | { type: "tool_started"; callId: string; tool: string }
  | {
      type: "tool_finished";
      callId: string;
      tool: string;
      ok: boolean;
      summary?: string;
    }
  | {
      type: "mutation";
      callId: string;
      tool: CopilotMutationToolName;
      rationale?: string;
      label?: string;
      result: CopilotMutationResult;
    }
  | {
      type: "run";
      callId: string;
      result: CopilotRunResult;
      /** Present only once a run has finished and the runtime read its results. */
      metrics?: MetricDelta[];
    }
  | { type: "suggestions"; items: Suggestion[] };

/** What the founder is looking at when they act, so the runtime can scope its reply. */
export type CopilotViewContext = {
  projectId: string;
  pathname: string;
  search: string;
  activeScenarioId: string | null;
};

export type CopilotRuntimeStatus =
  { state: "connected" } | { state: "unavailable"; reason: string };

export interface CopilotRuntimeAdapter {
  readonly status: CopilotRuntimeStatus;
  /** Streams runtime events for one project; returns an unsubscribe function. */
  subscribe(
    projectId: string,
    listener: (event: CopilotEvent) => void,
  ): () => void;
  /** A typed (or transcribed) founder turn, including suggestion chips. */
  send(input: { text: string; context: CopilotViewContext }): Promise<void>;
  /**
   * The founder's explicit answer to a `needs_confirmation` run. `confirmBudget` comes
   * only from this human action, never from the model.
   */
  confirmRun(input: {
    projectId: string;
    scenarioId: string;
    reason: "human_run" | "project_budget";
    approved: boolean;
  }): Promise<void>;
}
