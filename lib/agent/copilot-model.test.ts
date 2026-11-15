import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopilotDecisionSchema,
  copilotModelConfiguration,
  configuredCopilotDecisionModel,
  createDeepCopilotDecisionModel,
  type CopilotDecisionInput,
} from "./copilot-model";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

class ScriptedModel extends BaseChatModel {
  boundNames: string[] = [];
  calls: BaseMessage[][] = [];
  constructor(private readonly decision: Record<string, unknown>) {
    super({});
  }
  _llmType() {
    return "copilot-scripted";
  }
  bindTools(tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0]) {
    this.boundNames = tools.map((entry) =>
      "name" in entry
        ? String(entry.name)
        : "function" in entry
          ? String((entry.function as { name: string }).name)
          : "",
    );
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    this.calls.push(messages);
    if (this.calls.length > 1)
      throw new Error("Unexpected additional model call");
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "decision-1",
          name: this.boundNames[0]!,
          args: this.decision,
        },
      ],
    });
    return { generations: [{ text: "", message }] };
  }
}

const decision = {
  tool: "get_site_run",
  argsJson: '{"site_id":"site-1","run_id":"run-1"}',
  findings: ["Capacity needs inspection"],
  reply: "I'll inspect the saved run.",
  todos: [{ content: "Inspect capacity", status: "in_progress" }],
};
const input = (): CopilotDecisionInput => ({
  mode: "diagnose",
  context: { projectId: "project-1", comparisonId: "comparison-1" },
  history: [{ role: "user", content: "Why does this site struggle?" }],
  completedToolCalls: [],
  tools: [{ name: "get_site_run", description: "Read a saved run" }],
  signal: new AbortController().signal,
});

describe("copilot decision-only deepagents graph", () => {
  it("returns one decision and todo plan with scoped context/history, without executing business tools", async () => {
    const model = new ScriptedModel(decision);
    const args = input();
    args.completedToolCalls = [
      {
        tool: "evaluate_sites",
        args: {},
        output: { comparisonId: "comparison-1" },
      },
    ];
    expect(await createDeepCopilotDecisionModel(model)(args)).toEqual(decision);
    expect(model.calls).toHaveLength(1);
    expect(model.boundNames).toHaveLength(1);
    expect(model.boundNames).not.toEqual(
      expect.arrayContaining(["ls", "read_file", "task", "get_site_run"]),
    );
    const text = model.calls[0]!.map((message) =>
      JSON.stringify(message.content),
    ).join("\n");
    expect(text).toContain("comparison-1");
    expect(text).toContain("Why does this site struggle?");
    expect(text).toContain("evaluate_sites");
    expect(text).toContain("You cannot grant human approval");
  });

  it("rejects repeated completed calls even when argument key ordering differs", async () => {
    const args = input();
    args.completedToolCalls = [
      { tool: "get_site_run", args: { run_id: "run-1", site_id: "site-1" } },
    ];
    await expect(
      createDeepCopilotDecisionModel(new ScriptedModel(decision))(args),
    ).rejects.toThrow("repeated a completed tool call");
  });

  it("rejects unavailable tools and malformed argument objects", async () => {
    await expect(
      createDeepCopilotDecisionModel(
        new ScriptedModel({ ...decision, tool: "execute" }),
      )(input()),
    ).rejects.toThrow("unavailable tool");
    await expect(
      createDeepCopilotDecisionModel(
        new ScriptedModel({ ...decision, argsJson: "[]" }),
      )(input()),
    ).rejects.toThrow();
  });

  it("finishes with questions without requiring a business tool", async () => {
    const finish = {
      ...decision,
      tool: "finish",
      argsJson: "{}",
      reply: "Which site should I inspect?",
    };
    expect(
      await createDeepCopilotDecisionModel(new ScriptedModel(finish))(input()),
    ).toEqual(finish);
  });

  it("cannot produce trusted approval fields", () => {
    expect(
      CopilotDecisionSchema.safeParse({
        ...decision,
        approvals: { paidPoll: true },
      }).success,
    ).toBe(false);
    expect(
      CopilotDecisionSchema.safeParse({
        ...decision,
        todos: [{ content: "Approved", status: "approved" }],
      }).success,
    ).toBe(false);
  });

  it("honors cancellation before invoking the model", async () => {
    const model = new ScriptedModel(decision);
    const args = input();
    args.signal = AbortSignal.abort();
    await expect(createDeepCopilotDecisionModel(model)(args)).rejects.toThrow();
    expect(model.calls).toHaveLength(0);
  });

  it("matches the intake unavailable-configuration error without live calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "  ");
    await expect(configuredCopilotDecisionModel(input())).rejects.toThrow(
      "Intake model is not configured",
    );
  });

  it("uses the planning model only for diagnose/plans and retains bounded provider configuration", () => {
    const env = {
      OPENAI_API_KEY: "test-only",
      OPENAI_MODEL: "default-model",
      OPENAI_PLANNING_MODEL: "planning-model",
      OPENAI_BASE_URL: "https://provider.invalid/v1",
    };
    expect(copilotModelConfiguration(env, "diagnose").model).toBe(
      "planning-model",
    );
    expect(copilotModelConfiguration(env, "plans").model).toBe(
      "planning-model",
    );
    expect(copilotModelConfiguration(env, "chat")).toMatchObject({
      model: "default-model",
      maxRetries: 0,
      timeout: 10_000,
      configuration: { baseURL: "https://provider.invalid/v1" },
    });
    expect(
      copilotModelConfiguration(
        { OPENAI_API_KEY: "test-only", OPENAI_MODEL: " chosen " },
        "plans",
      ).model,
    ).toBe("chosen");
    expect(
      copilotModelConfiguration({ OPENAI_API_KEY: "test-only" }, "plans").model,
    ).toBeTruthy();
  });
});
