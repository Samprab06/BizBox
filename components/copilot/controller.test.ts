import { describe, expect, it } from "vitest";
import {
  CopilotEventSchema,
  type CopilotEvent,
} from "@/lib/contracts/copilot-runtime";
import { copilotRuntimeFixtures } from "@/fixtures/copilot-runtime";
import {
  cardActions,
  copilotReducer,
  initialCopilotState,
  MAX_ACTIVITY,
  restoreCopilotState,
  type CopilotAction,
  type CopilotState,
} from "./controller";

const context = {
  projectId: "p1",
  scenarioId: "base",
  page: "/projects/p1/map",
  view: "city" as const,
  revision: 1,
};

/** Builds a contract-valid event; sequence numbers count up per turn. */
function eventFactory(turnId = "turn-1") {
  let sequence = 0;
  return (payload: Record<string, unknown>): CopilotEvent =>
    CopilotEventSchema.parse({
      threadId: "thread",
      turnId,
      sequence: sequence++,
      context,
      ...payload,
    });
}

const reduce = (actions: CopilotAction[], from = initialCopilotState) =>
  actions.reduce(copilotReducer, from);
const apply = (events: CopilotEvent[], from?: CopilotState) =>
  reduce(
    events.map((event) => ({ type: "event", event }) as const),
    from,
  );

/** The runtime's order for one mutation: tool result, then its proposal. */
function mutation(
  make: ReturnType<typeof eventFactory>,
  callId: string,
  scenarioId: string,
) {
  return [
    make({ type: "tool_started", callId, tool: "set_hours" }),
    make({
      type: "tool_completed",
      callId,
      tool: "set_hours",
      sources: [],
      result: {
        status: "created",
        scenarioId,
        parentId: "base",
        diff: {
          sites: { added: [], removed: [] },
          changedPaths: ["overrides.hours.weekday.openMinute"],
          values: [],
        },
      },
    }),
    make({
      type: "proposal",
      proposal: {
        id: callId,
        baseScenarioId: "base",
        proposedScenarioId: scenarioId,
        title: "Proposed change",
        description:
          "Review the set_hours change before running or keeping it.",
        status: "pending",
        evidenceIds: [],
      },
    }),
  ];
}

describe("copilot dock controller", () => {
  it("creates exactly one diff card per agent mutation, even on replay", () => {
    const make = eventFactory();
    const first = mutation(make, "call-1", "s1");
    const second = mutation(make, "call-2", "s2");
    let state = apply([...first, ...second]);
    // A snapshot replay of the same events changes nothing.
    state = apply([...first, ...second], state);
    expect(
      state.cards.map((c) => [c.proposalId, c.proposedScenarioId]),
    ).toEqual([
      ["call-1", "s1"],
      ["call-2", "s2"],
    ]);
    expect(state.cards[0]).toMatchObject({
      title: "Changed opening hours",
      changedPaths: ["overrides.hours.weekday.openMinute"],
      status: "pending",
      run: "not_run",
    });
  });

  it("updates the same card when a later turn re-reports its proposal", () => {
    let state = apply(mutation(eventFactory(), "call-1", "s1"));
    const later = eventFactory("turn-2");
    state = apply(
      [
        later({ type: "turn_started", requestId: "r2" }),
        later({
          type: "proposal",
          proposal: {
            id: "call-1",
            baseScenarioId: "base",
            proposedScenarioId: "s1",
            title: "Proposed change",
            description: "Review it.",
            status: "kept",
            evidenceIds: [],
          },
        }),
      ],
      state,
    );
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0].status).toBe("kept");
    expect(cardActions(state.cards[0])).toEqual([]);
  });

  it("makes no card for rejected or unsupported mutations and says why", () => {
    const make = eventFactory();
    const state = apply([
      make({
        type: "tool_completed",
        callId: "c1",
        tool: "set_price",
        sources: [],
        result: {
          status: "rejected",
          code: "INVALID_INPUT",
          message: "Price must be positive",
        },
      }),
      make({
        type: "tool_completed",
        callId: "c2",
        tool: "edit_layout",
        sources: [],
        result: {
          status: "unsupported",
          code: "ADAPTER_UNAVAILABLE",
          message: "Layouts are not connected",
        },
      }),
    ]);
    expect(state.cards).toEqual([]);
    expect(state.activity.map((a) => [a.status, a.summary])).toEqual([
      ["failed", "Price must be positive"],
      ["failed", "Layouts are not connected"],
    ]);
  });

  it("shows a confirmation card for needs_confirmation, then tracks the run", () => {
    const make = eventFactory();
    let state = apply([
      ...mutation(make, "call-1", "s1"),
      make({
        type: "tool_completed",
        callId: "run-1",
        tool: "run_scenario",
        sources: [],
        result: {
          status: "needs_confirmation",
          reason: "project_budget",
          scenarioId: "s1",
        },
      }),
    ]);
    expect(state.confirmations).toEqual([
      { scenarioId: "s1", reason: "project_budget" },
    ]);
    expect(state.cards[0].run).toBe("awaiting_confirmation");
    expect(cardActions(state.cards[0])).toContain("run");

    const next = eventFactory("turn-2");
    state = apply(
      [
        next({
          type: "tool_completed",
          callId: "run-2",
          tool: "run_scenario",
          sources: [],
          result: {
            status: "succeeded",
            scenarioId: "s1",
            executionId: "e1",
            comparisonId: "c1",
            references: [],
          },
        }),
      ],
      state,
    );
    expect(state.confirmations).toEqual([]);
    expect(state.cards[0]).toMatchObject({
      run: "succeeded",
      comparisonId: "c1",
    });
  });

  it("Keep makes the proposed scenario active; Revert records the revert version", () => {
    let state = apply(mutation(eventFactory(), "call-1", "s1"));
    state = reduce(
      [{ type: "card_action", proposalId: "call-1", action: "keep" }],
      state,
    );
    expect(state.cards[0].pending).toBe("keep");
    expect(state.activeScenarioId).toBe("s1");
    // A second click while pending is ignored.
    expect(
      reduce(
        [{ type: "card_action", proposalId: "call-1", action: "revert" }],
        state,
      ),
    ).toBe(state);

    state = reduce(
      [
        { type: "card_action_failed", proposalId: "call-1", message: "No" },
        { type: "card_action", proposalId: "call-1", action: "revert" },
        {
          type: "revert_version_saved",
          proposalId: "call-1",
          revertScenarioId: "s3",
        },
      ],
      state,
    );
    expect(state.cards[0]).toMatchObject({
      status: "reverted",
      revertScenarioId: "s3",
      error: null,
    });
    expect(state.activeScenarioId).toBe("s3");
    expect(cardActions(state.cards[0])).toEqual([]);
  });

  it("keeps a failed revert version retryable with its message", () => {
    let state = apply(mutation(eventFactory(), "call-1", "s1"));
    state = reduce(
      [
        { type: "card_action", proposalId: "call-1", action: "revert" },
        {
          type: "revert_version_failed",
          proposalId: "call-1",
          message: "Unavailable",
        },
      ],
      state,
    );
    expect(state.cards[0]).toMatchObject({
      status: "reverted",
      revertVersionFailed: true,
      error: "Unavailable",
      pending: null,
    });
  });

  it("tracks plan, streamed replies with sources, and a resumable limit", () => {
    const make = eventFactory();
    const source = { kind: "modeled", label: "Modeled", evidenceIds: [] };
    const state = apply([
      make({ type: "turn_started", requestId: "r1" }),
      make({
        type: "todos",
        todos: [{ id: "1", content: "Compare sites", status: "in_progress" }],
      }),
      make({ type: "assistant_delta", text: "Hello ", sources: [source] }),
      make({ type: "assistant_delta", text: "there", sources: [source] }),
      make({
        type: "limit",
        reason: "tool_calls",
        message: "Tool-call limit reached.",
        resumable: true,
      }),
      make({
        type: "turn_finished",
        status: "paused",
        message: "Paused",
      }),
    ]);
    expect(state.plan).toHaveLength(1);
    expect(state.messages).toEqual([
      {
        id: "assistant:turn-1",
        role: "assistant",
        text: "Hello there",
        sources: [source],
      },
    ]);
    expect(state.turn).toMatchObject({ status: "paused", resumable: true });
    expect(state.notice?.tone).toBe("info");
  });

  it("caps the activity feed", () => {
    const make = eventFactory();
    const state = apply(
      Array.from({ length: MAX_ACTIVITY + 5 }, (_, i) =>
        make({ type: "tool_started", callId: `t${i}`, tool: "search_sites" }),
      ),
    );
    expect(state.activity).toHaveLength(MAX_ACTIVITY);
  });

  it("renders every HAC-83 runtime fixture with one card per proposal", () => {
    for (const fixture of copilotRuntimeFixtures) {
      const state = apply(fixture.events);
      expect(state.cards).toHaveLength(1);
      expect(state.cards[0].proposalId).toBe(fixture.proposal.id);
      expect(state.turn?.status).toBe("completed");
    }
  });
});

describe("persistence", () => {
  it("round-trips and drops in-flight work", () => {
    let state = apply(mutation(eventFactory(), "call-1", "s1"));
    state = reduce(
      [
        { type: "card_action", proposalId: "call-1", action: "run" },
        { type: "set_expanded", expanded: true },
      ],
      state,
    );
    const restored = restoreCopilotState(JSON.stringify(state));
    expect(restored?.cards[0].pending).toBeNull();
    expect(restored?.expanded).toBe(true);
    expect(restored?.seen).toEqual(state.seen);
  });

  it("ignores missing or corrupt storage", () => {
    expect(restoreCopilotState(null)).toBeNull();
    expect(restoreCopilotState("{")).toBeNull();
    expect(restoreCopilotState('{"cards":5}')).toBeNull();
  });
});
