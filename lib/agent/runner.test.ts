import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntakeSession } from "./intake";
import { createDeepIntakeRunner, PATCH_JSON_SCHEMA } from "./runner";

vi.mock("server-only", () => ({}));
afterEach(() => vi.restoreAllMocks());

class ScriptedModel extends BaseChatModel {
  boundNames: string[] = [];
  /** Messages received on each model call, in order. */
  calls: BaseMessage[][] = [];
  constructor(private readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "intake-test-model";
  }
  bindTools(tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0]) {
    this.boundNames = tools.map((entry) =>
      "name" in entry ? String(entry.name) : "",
    );
    return this;
  }
  async _generate(messages: BaseMessage[]) {
    this.calls.push(messages);
    const message = this.responses.shift();
    if (!message) throw new Error("Unexpected extra model invocation");
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

const unknown = (unit = "cents") => ({
  value: null,
  unit,
  unknownReason: "Not stated",
});
const saveCall = (id: string, args: Record<string, unknown>) =>
  new AIMessage({
    content: "",
    tool_calls: [{ id, name: "save_profile", args }],
  });
const lastToolResult = (model: ScriptedModel) =>
  JSON.parse(String(model.calls.at(-1)?.at(-1)?.content)) as Record<
    string,
    unknown
  >;
const run = (model: ScriptedModel, message: string) => {
  const session = createIntakeSession("project-1");
  const runner = createDeepIntakeRunner(model);
  return {
    session,
    reply: runner({ session, message, signal: new AbortController().signal }),
  };
};

const TICKET_MESSAGE =
  "I'm opening a neighborhood coffee shop called Bean There in Houston. Goal: find a walkable spot with strong morning commuter traffic.";

// Exercises the real compiled deepagents graph, not a mocked createDeepAgent.
describe("deepagents intake binding", () => {
  it("executes a model tool call against the validated session without a provider", async () => {
    const model = new ScriptedModel([
      saveCall("save-1", {
        category: "coffee",
        concept: "Coffee for commuters",
      }),
      new AIMessage("What is your business name and goal?"),
    ]);
    const session = createIntakeSession("project-1");
    const runner = createDeepIntakeRunner(model);
    const reply = await runner({
      session,
      message: "A coffee shop for commuters",
      signal: new AbortController().signal,
    });
    expect(session.snapshot().draft.concept).toBe("Coffee for commuters");
    expect(session.snapshot().draft.capacity?.serviceMinutes?.origin).toBe(
      "default",
    );
    expect(session.snapshot().profile).toBeNull();
    expect(reply).toContain("business name");
    expect(model.boundNames).toEqual(["save_profile"]);
  });

  it("HAC-113: saves the first-message facts, writes no budget unknowns, and asks the next question in one save", async () => {
    // The model repeats the live bug: it adds unknown budgets the founder never mentioned.
    const model = new ScriptedModel([
      saveCall("save-1", {
        businessName: "Bean There",
        concept: "Neighborhood coffee shop",
        category: "coffee",
        city: "Houston",
        objective: "Find a walkable spot with strong morning commuter traffic",
        economics: {
          monthlyRentCeilingCents: unknown(),
          buildoutBudgetCents: unknown(),
          startupBudgetCents: unknown(),
          monthlyOperatingBudgetCents: unknown(),
        },
      }),
      new AIMessage("Which areas do you prefer or want to avoid?"),
    ]);
    const { session, reply } = run(model, TICKET_MESSAGE);
    expect(await reply).toContain("areas");
    const { draft, findings } = session.snapshot();
    expect(draft).toMatchObject({
      businessName: "Bean There",
      concept: "Neighborhood coffee shop",
      category: "coffee",
      city: "Houston",
    });
    expect(draft.objective).toContain("morning commuter");
    // Fields stay undefined: no explicit unknown for any budget field.
    expect(draft.economics).toBeUndefined();
    expect(findings.join(" ")).not.toContain("Unknown founder information");
    // One save and one reply: two model calls in total.
    expect(model.calls).toHaveLength(2);
    const result = lastToolResult(model);
    expect(result).toMatchObject({
      saved: true,
      nextQuestion: { id: "location" },
    });
    expect(String(result.note)).toContain("economics.monthlyRentCeilingCents");
  });

  it("HAC-113: allows an unknown for rent when the founder says so, and only for rent", async () => {
    const model = new ScriptedModel([
      saveCall("save-1", {
        economics: {
          monthlyRentCeilingCents: unknown(),
          buildoutBudgetCents: unknown(),
        },
      }),
      new AIMessage("What is your buildout budget?"),
    ]);
    const { session, reply } = run(model, "I don't know my rent budget yet.");
    await reply;
    const { draft } = session.snapshot();
    expect(draft.economics?.monthlyRentCeilingCents).toMatchObject({
      value: null,
      origin: "founder",
    });
    expect(draft.economics?.buildoutBudgetCents).toBeUndefined();
  });

  it("HAC-113: returns a tool error without saving when every field is an unsupported unknown", async () => {
    const model = new ScriptedModel([
      saveCall("save-1", { economics: { startupBudgetCents: unknown() } }),
      new AIMessage("What is the business name?"),
    ]);
    const { session, reply } = run(model, "Hello there");
    expect(await reply).toContain("business name");
    expect(session.snapshot().draft).toEqual({});
    expect(lastToolResult(model)).toMatchObject({ saved: false });
  });

  it("HAC-113: reports invalid values as a tool error instead of failing the run", async () => {
    const model = new ScriptedModel([
      saveCall("save-1", { city: "Boston" }),
      saveCall("save-2", { city: "Houston" }),
      new AIMessage("Done."),
    ]);
    const { session, reply } = run(model, "We are in Houston");
    expect(await reply).toBe("Done.");
    expect(session.snapshot().draft.city).toBe("Houston");
    expect(model.calls).toHaveLength(3);
  });

  it("HAC-113: degrades gracefully at the tool limit and keeps what was saved", async () => {
    const loops = Array.from({ length: 14 }, (_, index) =>
      saveCall(`save-${index}`, {
        concept: index === 0 ? "Coffee for commuters" : `Variant ${index}`,
      }),
    );
    const model = new ScriptedModel(loops);
    const { session, reply } = run(model, "A coffee shop for commuters");
    const text = await reply;
    expect(text).toContain("saved");
    expect(text).toContain("business name");
    // The third and later saves are refused, so the draft keeps the second (last accepted) save.
    expect(session.snapshot().draft.concept).toBe("Variant 1");
    const log = model.calls.at(-1)?.at(-1)?.content;
    expect(String(log)).toContain("limit reached");
  });

  it("HAC-113: degrades gracefully when the step budget runs out before any save", async () => {
    const model = new ScriptedModel(
      Array.from({ length: 14 }, (_, index) =>
        saveCall(`bad-${index}`, { city: "Boston" }),
      ),
    );
    const { reply } = run(model, "We are in Boston");
    const text = await reply;
    expect(text).toContain("business name");
    expect(text).not.toContain("saved what you told me");
  });

  it("HAC-113: logs token usage per turn without prompts or secrets", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "save-1", name: "save_profile", args: { concept: "Coffee" } },
        ],
        usage_metadata: {
          input_tokens: 700,
          output_tokens: 40,
          total_tokens: 740,
        },
      }),
      new AIMessage({
        content: "Which city?",
        usage_metadata: {
          input_tokens: 900,
          output_tokens: 10,
          total_tokens: 910,
        },
      }),
    ]);
    const { reply } = run(model, "A secret-ish coffee plan");
    await reply;
    const lines = info.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      event: "intake_turn",
      outcome: "ok",
      saves: 1,
      saved: 1,
      rejectedUnknowns: 0,
      modelCalls: 2,
      inputTokens: 1600,
      outputTokens: 50,
      totalTokens: 1650,
    });
    expect(lines[0]).not.toContain("secret-ish");
  });

  it("HAC-113: keeps the model-facing tool schema slim and free of server-owned provenance", () => {
    const text = JSON.stringify(PATCH_JSON_SCHEMA);
    expect(text.length).toBeLessThan(7000);
    expect(text).not.toContain("evidenceIds");
    expect(text).not.toContain('"origin"');
  });
});
