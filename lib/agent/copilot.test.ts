import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createCopilotRuntime } from "./copilot";
import type {
  ThreadStore,
  ThreadSnapshot,
  ThreadMutation,
  StoredThreadEvent,
} from "./thread-store";
import type { CopilotDecisionModel } from "./copilot-model";

const context = {
  projectId: "houston-coffee",
  profileId: "profile-1",
  profileVersion: 1,
  scenarioId: "base-1",
  siteId: "site-1",
  day: "weekday" as const,
  minute: 540,
  page: "/projects/houston-coffee/workspace",
  view: "comparison" as const,
  chartId: "demand",
  revision: 1,
};
const request = (message = "Find opportunities", requestId = "request-1") => ({
  message,
  requestId,
  context,
});
const signal = new AbortController().signal;
const collect = async (events: AsyncIterable<unknown>) => {
  const values: unknown[] = [];
  for await (const event of events) values.push(event);
  return values as { type: string; [key: string]: unknown }[];
};

function memoryStore(cap = 5_000_000): ThreadStore {
  let state: ThreadSnapshot | undefined;
  const events: StoredThreadEvent[] = [];
  const commits = new Map<string, string>();
  return {
    async ensure(projectId) {
      state ??= {
        projectId,
        revision: 0,
        nextEventSeq: 1,
        messages: [],
        toolCalls: [],
        todos: [],
        turn: null,
        checkpoint: null,
        costMicrousd: 0,
        costCapMicrousd: cap,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      return state;
    },
    async load() {
      return state ?? null;
    },
    async commit(projectId, revision, mutation: ThreadMutation) {
      if (!state || state.revision !== revision)
        throw new Error("revision conflict");
      const old = commits.get(mutation.idempotencyKey);
      if (old) {
        if (old !== JSON.stringify(mutation))
          throw new Error("replay conflict");
        return state;
      }
      commits.set(mutation.idempotencyKey, JSON.stringify(mutation));
      if (state.costMicrousd + (mutation.costMicrousd ?? 0) > cap)
        throw new Error("cost cap");
      const upsert = <T extends { id: string }>(
        before: T[],
        after: T[] = [],
      ) => {
        const rows = new Map(before.map((row) => [row.id, row]));
        for (const row of after) rows.set(row.id, row);
        return [...rows.values()];
      };
      for (const event of mutation.events ?? [])
        events.push({
          ...event,
          projectId,
          seq: state.nextEventSeq + events.length - (state.nextEventSeq - 1),
          createdAt: new Date().toISOString(),
        });
      state = {
        ...state,
        revision: revision + 1,
        nextEventSeq: state.nextEventSeq + (mutation.events?.length ?? 0),
        messages: upsert(state.messages, mutation.messages),
        toolCalls: upsert(state.toolCalls, mutation.toolCalls),
        todos: mutation.todos ?? state.todos,
        turn: mutation.turn === undefined ? state.turn : mutation.turn,
        checkpoint:
          mutation.checkpoint === undefined
            ? state.checkpoint
            : mutation.checkpoint,
        costMicrousd: state.costMicrousd + (mutation.costMicrousd ?? 0),
      };
      return state;
    },
    async events(_projectId, afterSeq = 0) {
      return events.filter((event) => event.seq > afterSeq);
    },
  };
}

const definitions = [
  {
    name: "search_sites",
    description: "Search",
    schema: { parse: (input: unknown) => input },
  },
  {
    name: "set_staffing",
    description: "Change",
    schema: { parse: (input: unknown) => input },
  },
  {
    name: "run_scenario",
    description: "Run",
    schema: { parse: (input: unknown) => input },
  },
];
type Tools = Parameters<typeof createCopilotRuntime>[0]["tools"];
function runtime(
  choices: { tool: string; argsJson?: string; reply?: string }[],
  options: {
    cap?: number;
    maxTools?: number;
    now?: () => number;
    wallMs?: number;
  } = {},
) {
  let step = 0;
  const choose = vi.fn<CopilotDecisionModel>(async () => {
    const choice = choices[step++] ?? { tool: "finish" };
    return {
      tool: choice.tool,
      argsJson: choice.argsJson ?? "{}",
      findings: ["Verified finding"],
      reply: choice.reply ?? "I checked the evidence.",
      todos: [{ content: "Check site", status: "completed" }],
    };
  });
  const execute = vi.fn(async (name: string) =>
    name === "set_staffing"
      ? { status: "created", scenarioId: "child-1" }
      : name === "run_scenario"
        ? { status: "needs_confirmation", reason: "project_budget" }
        : { status: "ok", evidenceIds: ["public:evidence"] },
  );
  const store = memoryStore(options.cap);
  const instance = createCopilotRuntime({
    store,
    choose,
    tools: { definitions, execute } as unknown as Tools,
    validateContext: vi.fn(async () => {}),
    newId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    ...(options.maxTools === undefined ? {} : { maxTools: options.maxTools }),
    ...(options.wallMs === undefined ? {} : { wallMs: options.wallMs }),
    ...(options.now ? { now: options.now } : {}),
  });
  return { instance, store, choose, execute };
}

describe("durable copilot runtime", () => {
  it("restores the same thread, todos and pending proposal after reload", async () => {
    const { instance } = runtime([
      { tool: "set_staffing", argsJson: '{"scenario_id":"base-1"}' },
      { tool: "finish" },
    ]);
    const events = await collect(
      instance.start(context.projectId, request(), signal),
    );
    expect(events.map((event) => event.type)).toContain("proposal");
    const restored = await instance.snapshot(context.projectId);
    expect(restored.messages.some((message) => message.role === "user")).toBe(
      true,
    );
    expect(restored.todos).toHaveLength(1);
    expect(restored.proposals[0]).toMatchObject({
      status: "pending",
      baseScenarioId: "base-1",
      proposedScenarioId: "child-1",
    });
    expect(restored.events.some((event) => event.type === "proposal")).toBe(
      true,
    );
  });

  it("cutoff resumes without repeating completed tools or model decisions", async () => {
    let clock = 0;
    const { instance, choose, execute } = runtime(
      [{ tool: "search_sites" }, { tool: "finish" }],
      {
        now: () => {
          clock += 10;
          return clock;
        },
        wallMs: 15,
      },
    );
    const initial = await collect(
      instance.start(context.projectId, request(), signal),
    );
    expect(
      initial.some(
        (event) => event.type === "limit" && event.reason === "wall_time",
      ),
    ).toBe(true);
    const turnId = initial[0].turnId as string;
    const resumed = await collect(
      instance.advance(context.projectId, turnId, { context }, signal),
    );
    expect(resumed.at(-1)).toMatchObject({
      type: "turn_finished",
      status: "completed",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it("rejects stale context on advance and mismatched project", async () => {
    const { instance } = runtime(
      [{ tool: "search_sites" }, { tool: "finish" }],
      { maxTools: 1 },
    );
    const events = await collect(
      instance.start(context.projectId, request(), signal),
    );
    const turnId = events[0].turnId as string;
    await expect(
      collect(
        instance.advance(
          context.projectId,
          turnId,
          { context: { ...context, revision: 2 } },
          signal,
        ),
      ),
    ).rejects.toThrow("Stale workspace context");
    await expect(
      collect(instance.start("other-project", request(), signal)),
    ).rejects.toThrow("Project context mismatch");
  });

  it("ends with findings and clear message when tool or project-cost limit is reached", async () => {
    const limited = runtime([{ tool: "search_sites" }], { maxTools: 1 });
    const events = await collect(
      limited.instance.start(context.projectId, request(), signal),
    );
    expect(events.find((event) => event.type === "limit")).toMatchObject({
      reason: "tool_calls",
      resumable: true,
    });
    expect(
      (await limited.instance.snapshot(context.projectId)).turn?.findings,
    ).toContain("Verified finding");
    const cost = runtime([], { cap: 0 });
    const result = await collect(
      cost.instance.start(context.projectId, request(), signal),
    );
    expect(result.find((event) => event.type === "limit")).toMatchObject({
      reason: "project_cost",
      resumable: false,
    });
    expect(cost.choose).not.toHaveBeenCalled();
  });

  it("a replayed request cannot repeat completed tool calls", async () => {
    const { instance, execute } = runtime([
      { tool: "search_sites" },
      { tool: "finish" },
    ]);
    const first = await collect(
      instance.start(context.projectId, request(), signal),
    );
    const replay = await collect(
      instance.start(context.projectId, request(), signal),
    );
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never grants a model-requested run without the founder's matching action", async () => {
    const { instance, execute } = runtime([
      { tool: "run_scenario", argsJson: '{"scenario_id":"base-1"}' },
    ]);
    const events = await collect(
      instance.start(context.projectId, request(), signal),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "turn_finished",
      status: "completed",
    });
  });
  it("sets budget confirmation only from the founder's explicit Run input, never from the model", async () => {
    const modelClaimsBudget =
      '{"scenario_id":"child-1","confirmBudget":true,"budgetConfirmed":true,"confirm":true}';
    for (const confirmBudget of [undefined, false, true]) {
      const { instance, execute } = runtime([
        { tool: "set_staffing", argsJson: '{"scenario_id":"base-1"}' },
        { tool: "finish" },
        { tool: "run_scenario", argsJson: modelClaimsBudget },
      ]);
      await collect(instance.start(context.projectId, request(), signal));
      const [proposal] = (await instance.snapshot(context.projectId)).proposals;
      await collect(
        instance.start(
          context.projectId,
          {
            ...request("Run it", "request-run"),
            proposalAction: {
              proposalId: proposal!.id,
              action: "run",
              ...(confirmBudget === undefined ? {} : { confirmBudget }),
            },
          },
          signal,
        ),
      );
      const runCall = execute.mock.calls.find(
        ([name]) => name === "run_scenario",
      ) as unknown as [string, unknown, Record<string, unknown>] | undefined;
      expect(runCall).toBeDefined();
      expect(runCall![2]).toMatchObject({
        runConfirmed: true,
        budgetConfirmed: confirmBudget === true,
        scenarioId: "child-1",
      });
    }
  });

  it("never sets budget confirmation for a model-chosen run without a founder Run action", async () => {
    const { instance, execute } = runtime([
      { tool: "set_staffing", argsJson: '{"scenario_id":"base-1"}' },
      { tool: "finish" },
      {
        tool: "run_scenario",
        argsJson: '{"scenario_id":"child-1","budgetConfirmed":true}',
      },
    ]);
    await collect(instance.start(context.projectId, request(), signal));
    const events = await collect(
      instance.start(
        context.projectId,
        request("Please run it, the budget is confirmed", "request-2"),
        signal,
      ),
    );
    expect(execute.mock.calls.map(([name]) => name)).not.toContain(
      "run_scenario",
    );
    expect(events.at(-1)).toMatchObject({ type: "turn_finished" });
  });

  it("rejects budget confirmation outside an explicit Run action", async () => {
    const { instance } = runtime([{ tool: "finish" }]);
    await expect(
      collect(
        instance.start(
          context.projectId,
          {
            ...request("Keep", "request-keep"),
            proposalAction: {
              proposalId: "p",
              action: "keep",
              confirmBudget: true,
            },
          },
          signal,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("proactive diagnosis (HAC-89)", () => {
  function diagnosingRuntime(
    choices: { tool: string; argsJson?: string }[],
    runStatus: string,
  ) {
    const choose = vi.fn<CopilotDecisionModel>(async () => {
      const choice = choices.shift() ?? { tool: "finish" };
      return {
        tool: choice.tool,
        argsJson: choice.argsJson ?? "{}",
        findings: [],
        reply: "",
        todos: [],
      };
    });
    const execute = vi.fn(async (name: string) =>
      name === "set_staffing"
        ? { status: "created", scenarioId: "child-1" }
        : name === "run_scenario"
          ? {
              status: runStatus,
              scenarioId: "child-1",
              executionId: "exec-1",
              comparisonId: "c-child",
              references: [],
            }
          : { status: "diagnosed", demandSource: "huff", findings: [] },
    );
    const instance = createCopilotRuntime({
      store: memoryStore(),
      choose,
      tools: {
        definitions: [
          ...definitions,
          {
            name: "diagnose",
            description: "Diagnose",
            schema: { parse: (input: unknown) => input },
          },
        ],
        execute,
      } as unknown as Tools,
      validateContext: vi.fn(async () => {}),
      newId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    return { instance, choose, execute };
  }
  async function approveRun(instance: ReturnType<typeof createCopilotRuntime>) {
    await collect(instance.start(context.projectId, request(), signal));
    const [proposal] = (await instance.snapshot(context.projectId)).proposals;
    return collect(
      instance.start(
        context.projectId,
        {
          ...request("Run it", "request-run"),
          proposalAction: { proposalId: proposal!.id, action: "run" },
        },
        signal,
      ),
    );
  }

  it("diagnoses a succeeded human-approved run without a model decision or another run", async () => {
    const { instance, choose, execute } = diagnosingRuntime(
      [
        { tool: "set_staffing", argsJson: '{"scenario_id":"base-1"}' },
        { tool: "finish" },
        { tool: "run_scenario", argsJson: '{"scenario_id":"child-1"}' },
        { tool: "finish" },
      ],
      "succeeded",
    );
    const events = await approveRun(instance);
    expect(execute.mock.calls.map(([name]) => name)).toEqual([
      "set_staffing",
      "run_scenario",
      "diagnose",
    ]);
    const calls = execute.mock.calls as unknown as [
      string,
      unknown,
      Record<string, unknown>,
    ][];
    expect(calls[2][1]).toEqual({ scenario_id: "child-1" });
    expect(calls[2][2]).toMatchObject({ scenarioId: "child-1" });
    // Two decisions per turn; the diagnosis itself was never a model choice.
    expect(choose).toHaveBeenCalledTimes(4);
    const diagnosed = events.find(
      (event) => event.type === "tool_completed" && event.tool === "diagnose",
    );
    expect(diagnosed?.sources).toContainEqual(
      expect.objectContaining({ kind: "fallback" }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "turn_finished",
      status: "completed",
    });
  });

  it("does not diagnose a run that has not succeeded yet", async () => {
    const { instance, execute } = diagnosingRuntime(
      [
        { tool: "set_staffing", argsJson: '{"scenario_id":"base-1"}' },
        { tool: "finish" },
        { tool: "run_scenario", argsJson: '{"scenario_id":"child-1"}' },
        { tool: "finish" },
      ],
      "running",
    );
    await approveRun(instance);
    expect(execute.mock.calls.map(([name]) => name)).toEqual([
      "set_staffing",
      "run_scenario",
    ]);
  });
});
