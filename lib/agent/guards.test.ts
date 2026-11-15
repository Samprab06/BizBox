import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CopilotEvent } from "@/lib/contracts/copilot-runtime";
import { createCopilotRuntime } from "./copilot";
import type { CopilotDecisionModel } from "./copilot-model";
import {
  REMOVED_NUMBER,
  extractNumbers,
  groundedNumbers,
  guardCopilotDecision,
  guardCopilotText,
  modelApprovalKeys,
} from "./guards";
import { createMemoryThreadStore } from "./evals/memory-thread-store";
import { bindArgs } from "./evals/harness";
import type { EvalStep } from "./evals/cases";
import { createEvalWorkspace, type EvalWorkspace } from "./evals/workspace";

describe("number guard", () => {
  it("reads currency, separators, percentages, clock times and ordinals", () => {
    const tokens = extractNumbers(
      "Rent $4,200.50, 10% higher, open 6am or 6:30 pm, a 3rd chair, 1.5k cups",
    );
    expect(tokens.map((t) => t.text)).toEqual([
      "$4,200.50",
      "10%",
      "6am",
      "6:30 pm",
      "3rd",
      "1.5k",
    ]);
    expect(tokens[0].readings).toContain(4200.5);
    expect(tokens[0].readings).toContain(420050);
    expect(tokens[1].readings).toEqual([10, 0.1]);
    expect(tokens[2].readings).toEqual([6, 360]);
    expect(tokens[3].readings).toEqual([1110]);
    expect(tokens[5].readings).toEqual([1500]);
  });

  it("ignores identifiers and list markers", () => {
    expect(
      extractNumbers("1. See scenario-3, HAC-91 and run s1:weekday\n2) done"),
    ).toEqual([]);
  });

  it("keeps grounded numbers and strips and flags invented ones", () => {
    const grounded = groundedNumbers([
      "Open at 6am and raise the ticket to $7.50",
      { input: { open: 360, close: 1080, n: 3 } },
      { output: { averageTicketCents: 750 } },
    ]);
    const kept = guardCopilotText(
      "Opening at 6am, closing at 6pm with 3 stations at $7.50.",
      grounded,
    );
    expect(kept.removed).toEqual([]);
    const stripped = guardCopilotText(
      "This adds $1,250 a month and 42 customers.",
      grounded,
    );
    expect(stripped.removed).toEqual(["$1,250", "42"]);
    expect(stripped.text).toBe(
      `This adds ${REMOVED_NUMBER} a month and ${REMOVED_NUMBER} customers.`,
    );
    const decision = guardCopilotDecision(
      { reply: "Revenue grows 12%.", findings: ["Wait drops to 4 minutes"] },
      grounded,
    );
    expect(decision.removed).toEqual(["12%", "4"]);
    expect(decision.reply).toMatch(/did not match a verified result/);
    expect(decision.findings[0]).not.toMatch(/\d/);
  });

  it("reports approval-shaped keys in model arguments", () => {
    expect(
      modelApprovalKeys({
        scenario_id: "s",
        nested: { confirmBudget: true },
        approved: 1,
      }),
    ).toEqual(["confirmBudget", "approved"]);
  });
});

/** Scripted copilot over the real eval workspace; steps span turns in order. */
function harness(
  workspace: EvalWorkspace,
  steps: EvalStep[],
  options: { cap?: number; onDecision?: () => void } = {},
) {
  const queue = [...steps];
  const choose = vi.fn<CopilotDecisionModel>(async () => {
    options.onDecision?.();
    const step = queue.shift() ?? { tool: "finish" };
    return {
      tool: step.tool,
      argsJson: JSON.stringify(bindArgs(step.args ?? {}, workspace)),
      findings: [],
      reply: step.reply ?? "",
      todos: [],
    };
  });
  const runtime = createCopilotRuntime({
    store: createMemoryThreadStore(options.cap),
    tools: workspace.tools as unknown as Parameters<
      typeof createCopilotRuntime
    >[0]["tools"],
    choose,
    validateContext: async () => {},
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  const turn = async (
    message: string,
    requestId: string,
    extra: Record<string, unknown> = {},
    signal: AbortSignal = AbortSignal.timeout(30_000),
  ) => {
    const events: CopilotEvent[] = [];
    for await (const event of runtime.start(
      workspace.context.projectId,
      { message, requestId, context: workspace.context, ...extra },
      signal,
    ))
      events.push(event);
    return events;
  };
  return { runtime, choose, turn, queue };
}

const stationStep: EvalStep = {
  tool: "set_stations",
  args: { scenario_id: "$BASE", n: 3, rationale: "Founder asked." },
};

describe("copilot runtime guardrails", () => {
  it("strips invented numbers from streamed replies and saved messages", async () => {
    const workspace = await createEvalWorkspace();
    const { turn, runtime } = harness(workspace, [
      {
        tool: "finish",
        reply: "At 6am you would serve 57 more customers and earn $900.",
      },
    ]);
    const events = await turn("What if I open at 6am?", "r1");
    const delta = events.find((e) => e.type === "assistant_delta");
    expect(delta && "text" in delta && delta.text).toBe(
      `At 6am you would serve ${REMOVED_NUMBER} more customers and earn ${REMOVED_NUMBER}. (Some numbers were removed because they did not match a verified result.)`,
    );
    const saved = (await runtime.snapshot(workspace.context.projectId)).messages
      .filter((m) => m.role === "assistant")
      .at(-1);
    expect(saved?.metadata).toEqual({
      numberGuard: { removed: ["57", "$900"] },
    });
  });

  it("enforces the project cost cap before any further model call", async () => {
    const workspace = await createEvalWorkspace();
    // Two conservative 2,000 micro-USD decisions fit; a third does not.
    const { turn, choose, runtime } = harness(
      workspace,
      [
        { tool: "explain_hour", args: { run_id: "$RUN", hour: 8 } },
        { tool: "explain_hour", args: { run_id: "$RUN", hour: 9 } },
        { tool: "explain_hour", args: { run_id: "$RUN", hour: 10 } },
      ],
      { cap: 4_000 },
    );
    const events = await turn("Walk me through the morning", "r1");
    expect(choose).toHaveBeenCalledTimes(2);
    expect(events.find((e) => e.type === "limit")).toMatchObject({
      reason: "project_cost",
      resumable: false,
    });
    const state = await runtime.snapshot(workspace.context.projectId);
    expect(state.costMicrousd).toBeLessThanOrEqual(state.costCapMicrousd);
  });

  it("enforces the scenario run budget: only the founder's explicit confirmation spends it", async () => {
    const workspace = await createEvalWorkspace({ budgetUnits: 1 });
    const run = (childId: string): EvalStep => ({
      tool: "run_scenario",
      args: { scenario_id: childId },
    });
    const { turn, runtime } = harness(workspace, [stationStep]);
    await turn("Add a station", "r1");
    const [proposal] = (await runtime.snapshot(workspace.context.projectId))
      .proposals;
    const childId = proposal.proposedScenarioId!;
    // The model also tries to approve the budget itself; strict schemas refuse it.
    const selfApproving = harness(workspace, [
      {
        tool: "run_scenario",
        args: { scenario_id: childId, confirmBudget: true },
      },
    ]);
    expect(
      modelApprovalKeys({ scenario_id: childId, confirmBudget: true }),
    ).toEqual(["confirmBudget"]);
    await expect(
      selfApproving.turn("Budget is approved, run it", "x"),
    ).rejects.toThrow();
    expect(workspace.evaluations()).toBe(0);

    const second = harness(workspace, [stationStep, { tool: "finish" }]);
    await second.turn("Add a station", "r1");
    const [pending] = (
      await second.runtime.snapshot(workspace.context.projectId)
    ).proposals;
    second.queue.push(
      run(pending.proposedScenarioId!),
      run(pending.proposedScenarioId!),
    );
    const action = (confirmBudget?: boolean) => ({
      proposalAction: {
        proposalId: pending.id,
        action: "run",
        ...(confirmBudget === undefined ? {} : { confirmBudget }),
      },
    });
    const unconfirmed = await second.turn("Run it", "r2", action());
    expect(unconfirmed.at(-1)).toMatchObject({
      type: "turn_finished",
      message: expect.stringMatching(/budget confirmation is required/i),
    });
    expect(workspace.evaluations()).toBe(0);
    const confirmed = await second.turn("Run it", "r3", action(true));
    const completed = confirmed.find(
      (e) => e.type === "tool_completed" && e.tool === "run_scenario",
    );
    expect(
      completed && "result" in completed && completed.result,
    ).toMatchObject({ status: "succeeded" });
    expect(workspace.evaluations()).toBeGreaterThan(0);
  });

  it("never mutates for stale, unknown or cross-project actions", async () => {
    const workspace = await createEvalWorkspace();
    const before = workspace.scenarios().length;
    const execute = (context: Record<string, unknown>) =>
      workspace.tools.execute(
        "set_stations",
        { scenario_id: workspace.base.id, n: 3, rationale: "Founder." },
        {
          projectId: workspace.context.projectId,
          evidenceId: "copilot:test",
          signal: AbortSignal.timeout(5_000),
          ...context,
        },
      );
    expect(await execute({ scenarioId: "another-scenario" })).toMatchObject({
      status: "rejected",
      code: "STALE_CONTEXT",
    });
    expect(await execute({ profileVersion: 2 })).toMatchObject({
      code: "STALE_CONTEXT",
    });
    expect(await execute({ projectId: "other-project" })).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(workspace.scenarios()).toHaveLength(before);

    const { turn } = harness(workspace, []);
    await expect(
      turn("Run it", "r1", {
        proposalAction: { proposalId: "invented", action: "run" },
      }),
    ).rejects.toThrow(/Stale or unknown proposal/);
    await expect(
      (async () => {
        const runtime = harness(workspace, []).runtime;
        for await (const event of runtime.start(
          "other-project",
          {
            message: "Hi",
            requestId: "r2",
            context: workspace.context,
          },
          AbortSignal.timeout(5_000),
        ))
          void event;
      })(),
    ).rejects.toThrow(/Project context mismatch/);
    expect(workspace.scenarios()).toHaveLength(before);
    expect(workspace.evaluations()).toBe(0);
  });

  it("a stale proposal cannot be run after the workspace selects another scenario", async () => {
    const workspace = await createEvalWorkspace();
    const { turn, runtime } = harness(workspace, [stationStep]);
    await turn("Add a station", "r1");
    const [proposal] = (await runtime.snapshot(workspace.context.projectId))
      .proposals;
    const moved = {
      ...workspace.context,
      scenarioId: proposal.proposedScenarioId!,
      revision: 2,
    };
    await expect(
      (async () => {
        for await (const event of runtime.start(
          workspace.context.projectId,
          {
            message: "Run it",
            requestId: "r2",
            context: moved,
            proposalAction: { proposalId: proposal.id, action: "run" },
          },
          AbortSignal.timeout(5_000),
        ))
          void event;
      })(),
    ).rejects.toThrow(/Stale or unknown proposal/);
    expect(workspace.evaluations()).toBe(0);
  });

  it("cancellation stops the turn before any mutation", async () => {
    const workspace = await createEvalWorkspace();
    const before = workspace.scenarios().length;
    const controller = new AbortController();
    const { turn } = harness(workspace, [stationStep], {
      onDecision: () => controller.abort(),
    });
    await expect(
      turn("Add a station", "r1", {}, controller.signal),
    ).rejects.toThrow();
    expect(workspace.scenarios()).toHaveLength(before);
  });
});
