import type { CopilotRuntimeAdapter } from "./types";

export const RUNTIME_UNAVAILABLE_REASON =
  "The copilot runtime isn't connected yet. Proposed changes, the agent's plan and its tool activity will appear here once it is.";

/**
 * HAC-84: used until HAC-83 (Copilot runtime) supplies a real adapter. It never invents
 * replies or results: it reports that the runtime is unavailable and does nothing else.
 */
export const unavailableCopilotRuntime: CopilotRuntimeAdapter = {
  status: { state: "unavailable", reason: RUNTIME_UNAVAILABLE_REASON },
  subscribe: () => () => {},
  send: async () => {
    throw new Error(RUNTIME_UNAVAILABLE_REASON);
  },
  confirmRun: async () => {
    throw new Error(RUNTIME_UNAVAILABLE_REASON);
  },
};
