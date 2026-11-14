import { describe, expect, it } from "vitest";
import type { CopilotMutationResult } from "@/lib/contracts/copilot-tools";
import {
  copilotReducer,
  formatDelta,
  initialCopilotState,
  MAX_ACTIVITY,
  restoreCopilotState,
  type CopilotAction,
  type CopilotState,
} from "./controller";
import type { CopilotEvent } from "./types";

const created = (
  scenarioId: string,
  parentId = "base",
): CopilotMutationResult => ({
  status: "created",
  scenarioId,
  parentId,
  diff: {
    sites: { added: [], removed: [] },
    changedPaths: ["overrides.hours.weekday.openMinute"],
    values: [],
  },
});

const mutation = (callId: string, scenarioId: string): CopilotEvent => ({
  type: "mutation",
  callId,
  tool: "set_hours",
  rationale: "Try opening at 6am",
  result: created(scenarioId),
});

const reduce = (actions: CopilotAction[], from = initialCopilotState) =>
  actions.reduce(copilotReducer, from);
const events = (list: CopilotEvent[], from?: CopilotState) =>
  reduce(
    list.map((event) => ({ type: "event", event }) as const),
    from,
  );

describe("copilot dock controller", () => {
  it("creates exactly one diff card per agent mutation", () => {
    const state = events([
      mutation("call-1", "s1"),
      mutation("call-1", "s1"), // replayed event
      mutation("call-2", "s2"),
    ]);
    expect(state.cards.map((c) => [c.callId, c.scenarioId])).toEqual([
      ["call-1", "s1"],
      ["call-2", "s2"],
    ]);
    expect(state.cards[0]).toMatchObject({
      parentId: "base",
      run: "not_run",
      decision: { state: "proposed" },
    });
  });

  it("makes no card for rejected or unsupported mutations and says why", () => {
    const state = events([
      {
        type: "mutation",
        callId: "call-1",
        tool: "set_price",
        result: {
          status: "rejected",
          code: "INVALID_INPUT",
          message: "Price must be positive",
        },
      },
      {
        type: "mutation",
        callId: "call-2",
        tool: "edit_layout",
        result: {
          status: "unsupported",
          code: "ADAPTER_UNAVAILABLE",
          message: "Layouts are not connected",
        },
      },
    ]);
    expect(state.cards).toEqual([]);
    expect(state.activity.map((a) => [a.status, a.summary])).toEqual([
      ["failed", "Price must be positive"],
      ["failed", "Layouts are not connected"],
    ]);
  });

  it("attaches run status and metric deltas to the scenario's card", () => {
    const metrics = [
      {
        key: "wait",
        label: "Average wait",
        unit: "min",
        before: 4,
        after: 2.5,
        origin: "simulation",
      },
    ];
    const state = events([
      mutation("call-1", "s1"),
      {
        type: "run",
        callId: "run-1",
        result: {
          status: "running",
          scenarioId: "s1",
          executionId: "e1",
          comparisonId: null,
          references: [],
        },
      },
      {
        type: "run",
        callId: "run-1",
        result: {
          status: "succeeded",
          scenarioId: "s1",
          executionId: "e1",
          comparisonId: "c1",
          references: [],
        },
        metrics,
      },
    ]);
    expect(state.cards[0]).toMatchObject({
      run: "succeeded",
      executionId: "e1",
      comparisonId: "c1",
      metrics,
    });
    expect(state.activity.find((a) => a.id === "run-1")?.status).toBe("done");
  });

  it("shows a confirmation card for needs_confirmation and clears it on run", () => {
    let state = events([
      mutation("call-1", "s1"),
      {
        type: "run",
        callId: "run-1",
        result: {
          status: "needs_confirmation",
          reason: "project_budget",
          scenarioId: "s1",
        },
      },
    ]);
    expect(state.confirmations).toEqual([
      { scenarioId: "s1", reason: "project_budget", pending: false },
    ]);
    state = reduce([{ type: "confirmation_pending", scenarioId: "s1" }], state);
    expect(state.confirmations[0].pending).toBe(true);
    state = events(
      [
        {
          type: "run",
          callId: "run-1",
          result: {
            status: "queued",
            scenarioId: "s1",
            executionId: "e1",
            comparisonId: null,
            references: [],
          },
        },
      ],
      state,
    );
    expect(state.confirmations).toEqual([]);
    expect(state.cards[0].run).toBe("queued");
  });

  it("Keep makes the scenario active; Revert records the revert version", () => {
    let state = events([mutation("call-1", "s1"), mutation("call-2", "s2")]);
    state = reduce([{ type: "keep", callId: "call-1" }], state);
    expect(state.cards[0].decision).toEqual({ state: "kept" });
    expect(state.activeScenarioId).toBe("s1");

    state = reduce(
      [
        { type: "revert_started", callId: "call-1" },
        { type: "revert_succeeded", callId: "call-1", revertScenarioId: "s3" },
      ],
      state,
    );
    expect(state.cards[0].decision).toEqual({
      state: "reverted",
      revertScenarioId: "s3",
    });
    expect(state.activeScenarioId).toBe("s3");
    // A reverted card can't be kept again.
    expect(reduce([{ type: "keep", callId: "call-1" }], state)).toBe(state);
    expect(state.cards).toHaveLength(2);
  });

  it("keeps a failed revert retryable with its message", () => {
    const state = reduce(
      [
        { type: "event", event: mutation("call-1", "s1") },
        { type: "revert_started", callId: "call-1" },
        { type: "revert_failed", callId: "call-1", message: "Unavailable" },
      ],
      initialCopilotState,
    );
    expect(state.cards[0].decision).toEqual({
      state: "revert_failed",
      message: "Unavailable",
    });
  });

  it("caps the activity feed and tracks tool progress", () => {
    const list: CopilotEvent[] = Array.from(
      { length: MAX_ACTIVITY + 5 },
      (_, i) => ({
        type: "tool_started",
        callId: `t${i}`,
        tool: "search_sites",
      }),
    );
    let state = events(list);
    expect(state.activity).toHaveLength(MAX_ACTIVITY);
    state = events(
      [
        {
          type: "tool_finished",
          callId: `t${MAX_ACTIVITY + 4}`,
          tool: "search_sites",
          ok: true,
          summary: "Found 6 spaces",
        },
      ],
      state,
    );
    expect(state.activity.at(-1)).toMatchObject({
      status: "done",
      summary: "Found 6 spaces",
    });
  });

  it("replaces the plan and suggestions and dedupes messages", () => {
    const state = events([
      {
        type: "plan",
        items: [{ id: "1", label: "Compare sites", status: "in_progress" }],
      },
      {
        type: "suggestions",
        items: [{ id: "a", label: "Try 6am", prompt: "Try opening at 6am" }],
      },
      { type: "message", id: "m1", role: "assistant", text: "Hello" },
      { type: "message", id: "m1", role: "assistant", text: "Hello" },
    ]);
    expect(state.plan).toHaveLength(1);
    expect(state.suggestions).toHaveLength(1);
    expect(state.messages).toHaveLength(1);
  });
});

describe("persistence", () => {
  it("round-trips and drops in-flight work", () => {
    let state = events([mutation("call-1", "s1")]);
    state = reduce(
      [
        { type: "revert_started", callId: "call-1" },
        { type: "set_expanded", expanded: true },
      ],
      state,
    );
    const restored = restoreCopilotState(JSON.stringify(state));
    expect(restored?.cards[0].decision).toEqual({ state: "proposed" });
    expect(restored?.expanded).toBe(true);
  });

  it("ignores missing or corrupt storage", () => {
    expect(restoreCopilotState(null)).toBeNull();
    expect(restoreCopilotState("{")).toBeNull();
    expect(restoreCopilotState('{"cards":5}')).toBeNull();
  });
});

describe("formatDelta", () => {
  const metric = { key: "k", label: "L", unit: "min", origin: "simulation" };
  it("signs the change and keeps unknowns unknown", () => {
    expect(formatDelta({ ...metric, before: 4, after: 2.5 })).toBe("−1.5 min");
    expect(formatDelta({ ...metric, before: 1, after: 3 })).toBe("+2 min");
    expect(formatDelta({ ...metric, before: 1, after: 1 })).toBe("±0 min");
    expect(formatDelta({ ...metric, before: null, after: 1 })).toBeNull();
  });
});
