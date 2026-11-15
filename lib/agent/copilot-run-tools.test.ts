import { AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { describe, expect, it, vi } from "vitest";
import {
  CopilotRunResultSchema,
  CopilotRunScenarioSchema,
  type CopilotRunResult,
} from "@/lib/contracts/copilot-run-tools";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { FIXTURE_PERSONA_SET, SITE_A } from "@/lib/demand/fixtures";
import { evaluateSitesResumable } from "@/lib/evaluation/evaluate";
import { createMemoryComparisonStore } from "@/lib/evaluation/store";
import { createRootScenario, deriveScenario } from "@/lib/scenario/model";
import { createScenarioRunner } from "@/lib/scenario/run";
import { createMemoryScenarioExecutionStore } from "@/lib/scenario/run-store-memory";
import type { CopilotMutationContext } from "./copilot-tools";
import { createCopilotRunTools } from "./copilot-run-tools";

class ScriptedModel extends BaseChatModel {
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "copilot-run-offline-test";
  }
  bindTools() {
    return this;
  }
  async _generate() {
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected model call");
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}

function setup(budgetUnits = 1200) {
  const scenario = createRootScenario({
    id: "s1",
    projectId: "p1",
    profileVersion: 1,
    siteIds: [SITE_A.id],
    label: "Baseline",
    author: "founder",
    createdAt: "2026-11-14T16:00:00.000Z",
    overrides: {
      seedSet: {
        value: [7],
        unit: "seeds",
        origin: "default",
        evidenceIds: ["fixture"],
      },
      staffHeadcount: {
        value: 2,
        unit: "people",
        origin: "founder",
        evidenceIds: ["founder-answer"],
      },
    },
  });
  const rows = new Map([[scenario.id, scenario]]);
  const get = vi.fn(async (project: string, id: string) => {
    const row = rows.get(id);
    if (!row || row.projectId !== project)
      throw Object.assign(new Error("Missing"), { code: "not_found" });
    return structuredClone(row);
  });
  const executions = createMemoryScenarioExecutionStore();
  const comparisons = createMemoryComparisonStore({ p1: 1 });
  const prepare = vi.fn(async () => ({
    request: EvaluationRequestSchema.parse({
      projectId: "p1",
      profileId: "profile-v1",
      profileVersion: 1,
      synthetic: true,
      city: "houston",
      category: "coffee",
      priceTier: "mid",
      personaSet: FIXTURE_PERSONA_SET,
      demandSource: "huff",
      seeds: 1,
      seedSet: [7],
      sites: [
        {
          siteId: SITE_A.id,
          storefront: SITE_A,
          config: {
            hours: {
              weekday: { openMin: 360, closeMin: 1080 },
              weekend: { openMin: 360, closeMin: 1080 },
            },
            stations: { planned: 2, usableSf: 1800, sfPerStation: 100 },
            prices: { avgTicketUsd: 6.5 },
            staff: { headcount: 2, wageUsdPerHour: 16 },
            costs: { cogsPctOfRevenue: 0.28 },
            lease: {
              sf: 1800,
              askingRentUsdPerSfYear: 24,
              tripleNet: false,
              buildoutUsd: 30000,
              leaseTermMonths: 60,
            },
            calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
          },
        },
      ],
    }),
    findings: [],
    assumptions: {},
  }));
  const evaluate = vi.fn(evaluateSitesResumable);
  let sequence = 0;
  const actual = createScenarioRunner({
    scenarios: { get },
    executions,
    comparisons,
    prepare,
    evaluate,
    budgetUnits,
    newId: () => `execution-${++sequence}`,
    now: () => new Date("2026-11-14T17:00:00.000Z"),
  });
  const runner = {
    start: vi.fn(actual.start),
    advance: vi.fn(actual.advance),
    get: vi.fn(actual.get),
  };
  const registry = createCopilotRunTools({ scenarios: { get }, runner });
  const context: CopilotMutationContext & {
    runConfirmed?: boolean;
    budgetConfirmed?: boolean;
    scenarioId?: string;
    profileVersion?: number;
  } = {
    projectId: "p1",
    evidenceId: "human-run",
    signal: new AbortController().signal,
    scenarioId: "s1",
    profileVersion: 1,
    runConfirmed: true,
  };
  return {
    registry,
    context,
    runner,
    executions,
    comparisons,
    scenario,
    rows,
    prepare,
    evaluate,
    get,
  };
}
const input = { scenario_id: "s1" };

describe("copilot checkpointed runs", () => {
  it("requires trusted human opt-in before start or advance even within budget", async () => {
    const { registry, context, runner, prepare } = setup();
    for (const args of [input, { ...input, execution_id: "execution-1" }]) {
      expect(
        await registry.execute("run_scenario", args, {
          ...context,
          runConfirmed: false,
        }),
      ).toEqual({
        status: "needs_confirmation",
        reason: "human_run",
        scenarioId: "s1",
      });
    }
    expect(runner.start).not.toHaveBeenCalled();
    expect(runner.advance).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    "confirm",
    "runConfirmed",
    "budgetConfirmed",
    "projectId",
    "profileVersion",
    "demandSource",
  ])("rejects model-authored %s", async (key) => {
    const { registry, context, runner } = setup();
    const args = { ...input, [key]: true };
    expect(CopilotRunScenarioSchema.safeParse(args).success).toBe(false);
    expect(await registry.execute("run_scenario", args, context)).toMatchObject(
      { status: "rejected", code: "INVALID_INPUT" },
    );
    expect(runner.start).not.toHaveBeenCalled();
  });

  it("keeps human Run approval separate from the existing rolling project budget", async () => {
    const { registry, context, runner, prepare } = setup(1);
    expect(await registry.execute("run_scenario", input, context)).toEqual({
      status: "needs_confirmation",
      reason: "project_budget",
      scenarioId: "s1",
    });
    expect(runner.start).toHaveBeenCalledWith("p1", "s1", { confirm: false });
    expect(prepare).not.toHaveBeenCalled();
    expect(
      await registry.execute("run_scenario", input, {
        ...context,
        budgetConfirmed: true,
      }),
    ).toMatchObject({ status: "succeeded" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("uses runner idempotency/cache, returns references only and preserves scenario provenance", async () => {
    const { registry, context, scenario, rows, prepare, evaluate, executions } =
      setup();
    const before = structuredClone(scenario);
    const first = await registry.execute("run_scenario", input, context);
    expect(first).toMatchObject({
      status: "succeeded",
      executionId: "execution-1",
      comparisonId: "execution-1:comparison",
    });
    expect(CopilotRunResultSchema.parse(first)).toEqual(first);
    expect(await registry.execute("run_scenario", input, context)).toEqual(
      first,
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect((await executions.get("p1", "execution-1"))?.costUnits).toBe(2);
    expect(rows.get("s1")).toEqual(before);
    expect(rows.size).toBe(1);
    for (const forbidden of [
      "events",
      "costUnits",
      "monthlyRevenueUsd",
      "runIds",
      "completedSiteIds",
    ])
      expect(JSON.stringify(first)).not.toContain(`"${forbidden}"`);
    expect(first).toMatchObject({
      references: [
        {
          kind: "scenario_execution",
          scenarioId: "s1",
          executionId: "execution-1",
        },
        { kind: "comparison", comparisonId: "execution-1:comparison" },
      ],
    });
  });

  it("resumes at most one slice and does not poll or re-advance a completed run", async () => {
    const { registry, context, evaluate, runner } = setup();
    evaluate.mockResolvedValueOnce({
      status: "partial",
      completed: {},
      pendingSiteIds: [SITE_A.id],
    });
    const started = await registry.execute("run_scenario", input, context);
    expect(started).toMatchObject({
      status: "running",
      executionId: "execution-1",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    const args = { ...input, execution_id: "execution-1" };
    expect(await registry.execute("run_scenario", args, context)).toMatchObject(
      { status: "succeeded" },
    );
    expect(runner.advance).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(await registry.execute("run_scenario", args, context)).toMatchObject(
      { status: "succeeded" },
    );
    expect(runner.advance).toHaveBeenCalledTimes(1);
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it("shares the runner's rolling budget across different inputs and reuses equivalent-fork comparisons for free", async () => {
    const { registry, context, scenario, rows, executions, evaluate } =
      setup(3);
    const first = await registry.execute("run_scenario", input, context);
    expect(first.status).toBe("succeeded");
    rows.set(
      "fork",
      deriveScenario(
        scenario,
        { label: "Equivalent fork" },
        {
          id: "fork",
          author: "founder",
          createdAt: scenario.createdAt,
        },
      ),
    );
    const cached = await registry.execute(
      "run_scenario",
      { scenario_id: "fork" },
      { ...context, scenarioId: "fork" },
    );
    expect(cached).toMatchObject({
      status: "succeeded",
      scenarioId: "fork",
      comparisonId: "execution-1:comparison",
    });
    if (!("executionId" in cached)) throw new Error("Missing execution");
    expect((await executions.get("p1", cached.executionId))?.costUnits).toBe(0);
    rows.set(
      "changed",
      deriveScenario(
        scenario,
        { layoutId: "new-layout" },
        {
          id: "changed",
          author: "founder",
          createdAt: scenario.createdAt,
        },
      ),
    );
    expect(
      await registry.execute(
        "run_scenario",
        { scenario_id: "changed" },
        { ...context, scenarioId: "changed" },
      ),
    ).toEqual({
      status: "needs_confirmation",
      reason: "project_budget",
      scenarioId: "changed",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("forwards trusted idempotency and validates scoped execution responses before advancing", async () => {
    const { registry, context, runner } = setup();
    await registry.execute("run_scenario", input, {
      ...context,
      idempotencyKey: "trusted-action",
    });
    expect(runner.start).toHaveBeenCalledWith("p1", "s1", {
      confirm: false,
      idempotencyKey: "trusted-action",
    });
    runner.get.mockResolvedValueOnce({
      status: "running",
      scenarioId: "foreign",
      runId: "execution-1",
      comparisonId: null,
      runIds: [],
      cached: false,
      costUnits: 2,
      completedSiteIds: [],
    });
    expect(
      await registry.execute(
        "run_scenario",
        { ...input, execution_id: "execution-1" },
        context,
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(runner.advance).not.toHaveBeenCalled();
  });

  it("rejects foreign projects, stale profiles, unexpected scenarios and foreign executions before advancing", async () => {
    const { registry, context, runner, rows, scenario } = setup();
    for (const scope of [
      { projectId: "p2" },
      { profileVersion: 2 },
      { scenarioId: "s2" },
    ]) {
      expect(
        await registry.execute("run_scenario", input, { ...context, ...scope }),
      ).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(runner.start).not.toHaveBeenCalled();
    await registry.execute("run_scenario", input, context);
    rows.set(
      "s2",
      deriveScenario(
        scenario,
        { label: "Other" },
        { id: "s2", createdAt: scenario.createdAt, author: "founder" },
      ),
    );
    expect(
      await registry.execute(
        "run_scenario",
        { scenario_id: "s2", execution_id: "execution-1" },
        { ...context, scenarioId: "s2" },
      ),
    ).toMatchObject({ code: "NOT_FOUND" });
    expect(runner.advance).not.toHaveBeenCalled();
  });

  it("checks cancellation before work, after scoped lookup, and after an in-flight runner slice", async () => {
    const { registry, context, runner, get } = setup();
    const before = new AbortController();
    before.abort();
    await expect(
      registry.execute("run_scenario", input, {
        ...context,
        signal: before.signal,
      }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    const duringLookup = new AbortController();
    const original = get.getMockImplementation()!;
    get.mockImplementationOnce(async (...args) => {
      const row = await original(...args);
      duringLookup.abort();
      return row;
    });
    await expect(
      registry.execute("run_scenario", input, {
        ...context,
        signal: duringLookup.signal,
      }),
    ).rejects.toThrow();
    expect(runner.start).not.toHaveBeenCalled();
    const duringRun = new AbortController();
    const start = runner.start.getMockImplementation()!;
    runner.start.mockImplementationOnce(async (...args) => {
      const result = await start(...args);
      duringRun.abort();
      return result;
    });
    await expect(
      registry.execute("run_scenario", input, {
        ...context,
        signal: duringRun.signal,
      }),
    ).rejects.toThrow();
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(runner.advance).not.toHaveBeenCalled();
  });

  it("does not advance after a cancelled resume lookup and sanitizes dependency failures", async () => {
    const { registry, context, runner } = setup();
    await registry.execute("run_scenario", input, context);
    const controller = new AbortController();
    const get = runner.get.getMockImplementation()!;
    runner.get.mockImplementationOnce(async (...args) => {
      const value = await get(...args);
      controller.abort();
      return value;
    });
    await expect(
      registry.execute(
        "run_scenario",
        { ...input, execution_id: "execution-1" },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(runner.advance).not.toHaveBeenCalled();
    runner.start.mockRejectedValueOnce(new Error("postgres://secret"));
    const result = await registry.execute("run_scenario", input, context);
    expect(result).toMatchObject({ status: "rejected", code: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("executes the real compiled deepagent tool without provider calls", async () => {
    const { registry, context, evaluate } = setup();
    let output: CopilotRunResult | undefined;
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [{ id: "run", name: "run_scenario", args: input }],
      }),
      new AIMessage("Execution reference available."),
    ]);
    const agent = createDeepAgent({
      model,
      tools: registry.definitions.map((definition) =>
        tool(async (args: unknown) => {
          output = await registry.execute(definition.name, args, context);
          return JSON.stringify(output);
        }, definition),
      ),
      middleware: [
        { name: "FilesystemMiddleware", tools: [] },
        { name: "subAgentMiddleware", tools: [] },
      ],
    });
    await agent.invoke(
      { messages: [{ role: "user", content: "Run this approved scenario." }] },
      { recursionLimit: 10 },
    );
    expect(CopilotRunResultSchema.parse(output).status).toBe("succeeded");
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
