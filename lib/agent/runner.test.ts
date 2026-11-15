import { formatViewContext } from "./view-context";
import { AgentViewContextSchema } from "@/lib/contracts/agent";
import { AIMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiAction } from "@/lib/contracts/agent";
import {
  fixtureUiLookups,
  ScriptedModel,
  UI_FIXTURE,
} from "./__fixtures__/scripted-model";
import { createIntakeSession } from "./intake";
import {
  createDeepIntakeRunner,
  INTAKE_MAX_SAVES,
  INTAKE_RECURSION_LIMIT,
  PATCH_JSON_SCHEMA,
} from "./runner";
import { FLOW_UI_TOOL_NAMES } from "./ui-tools";
import { FLOW_TOOL_NAMES } from "./flow-tools";

vi.mock("server-only", () => ({}));
afterEach(() => vi.restoreAllMocks());

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
  it("rejects model-authored map rectangles while preserving founder geometry", async () => {
    const founderGeometry = {
      city: "Houston" as const,
      rectangles: [
        {
          bounds: [-95.5, 29.6, -95.3, 29.8] as [
            number,
            number,
            number,
            number,
          ],
          brush: "avoid" as const,
        },
      ],
    };
    const session = createIntakeSession("project-1", {
      draft: { city: "Houston", areaPreferences: founderGeometry },
      assumptions: {},
    });
    const model = new ScriptedModel([
      saveCall("invent-geometry", {
        areaPreferences: { city: "Houston", rectangles: [] },
      }),
      new AIMessage("Please edit your map to change those areas."),
    ]);
    await createDeepIntakeRunner(model)({
      session,
      message: "Help me review my areas",
      signal: new AbortController().signal,
    });
    expect(session.snapshot().draft.areaPreferences).toEqual(founderGeometry);
    expect(lastToolResult(model)).toMatchObject({ saved: false });
  });

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
    // Without UI context (no trusted lookups) only save_profile is bound.
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
      viewContextBytes: 0,
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

const uiCall = (
  calls: { id: string; name: string; args: Record<string, unknown> }[],
  content = "",
) => new AIMessage({ content, tool_calls: calls });
const runWithUi = (
  model: ScriptedModel,
  message: string,
  options: { city?: "Houston" | "Los Angeles"; view?: object } = {},
) => {
  const session = createIntakeSession(UI_FIXTURE.projectId);
  if (options.city) session.saveProfile({ city: options.city });
  const actions: UiAction[] = [];
  let n = 0;
  const lookups = fixtureUiLookups();
  const reply = createDeepIntakeRunner(model)({
    session,
    message,
    signal: new AbortController().signal,
    viewContextLine: options.view
      ? formatViewContext(AgentViewContextSchema.parse(options.view))
      : undefined,
    ui: {
      projectId: UI_FIXTURE.projectId,
      lookups,
      view: options.view as never,
      actions,
      newId: () => `ui_${++n}`,
    },
  });
  return { session, actions, reply, lookups };
};
const toolResults = (model: ScriptedModel) =>
  (model.calls.at(-1) ?? [])
    .filter((entry) => entry.type === "tool")
    .map((entry) => String(entry.content));

describe("HAC-144 UI tool group", () => {
  it("binds save_profile plus the in-workspace UI tools and the flow tools, with deliberate limits", async () => {
    const model = new ScriptedModel([new AIMessage("Hello!")]);
    const { reply } = runWithUi(model, "Hi");
    await reply;
    expect(model.boundNames).toEqual([
      "save_profile",
      ...FLOW_UI_TOOL_NAMES,
      ...FLOW_TOOL_NAMES,
    ]);
    // Page jumps to the legacy screens are no longer bound.
    expect(FLOW_UI_TOOL_NAMES).toEqual(["open_site", "focus_map", "highlight"]);
    for (const legacy of [
      "show_step",
      "show_comparison",
      "open_simulator",
      "open_interior",
      "show_plan",
    ])
      expect(model.boundNames).not.toContain(legacy);
    expect(INTAKE_RECURSION_LIMIT).toBe(16);
    expect(INTAKE_MAX_SAVES).toBe(2);
    const system = JSON.stringify(model.calls[0]?.[0]?.content);
    expect(system).toContain("never send the founder to other pages");
  });

  it('"show me spaces in Montrose" produces go_to_step plus open_site with a valid site ID', async () => {
    const view = {
      stage: "workspace",
      candidateIds: [UI_FIXTURE.montroseSiteId, UI_FIXTURE.heightsSiteId],
    };
    const model = new ScriptedModel([
      uiCall([
        { id: "ui-1", name: "go_to_step", args: { step: "locations" } },
        {
          id: "ui-2",
          name: "open_site",
          args: { siteId: UI_FIXTURE.montroseSiteId },
        },
      ]),
      new AIMessage("Here are the spaces; I opened the Montrose suite."),
    ]);
    const { actions, reply } = runWithUi(model, "show me spaces in Montrose", {
      city: "Houston",
      view,
    });
    expect(await reply).toContain("Montrose");
    expect(actions).toEqual([
      { id: "ui_1", type: "go_to_step", step: "locations" },
      { id: "ui_2", type: "open_site", siteId: UI_FIXTURE.montroseSiteId },
    ]);
    // The model saw the founder's screen, so it had real candidate IDs to use.
    expect(String(model.calls[0]?.at(-1)?.content)).toContain(
      UI_FIXTURE.montroseSiteId,
    );
    expect(toolResults(model).every((text) => text.startsWith("Queued"))).toBe(
      true,
    );
  });

  it("rejects spoofed and foreign IDs server-side and queues nothing for them", async () => {
    const model = new ScriptedModel([
      uiCall([
        { id: "a", name: "open_site", args: { siteId: "L-fake:S-9" } },
        {
          id: "b",
          name: "open_site",
          args: { siteId: UI_FIXTURE.losAngelesSiteId },
        },
        {
          id: "c",
          name: "present_top_sites",
          args: { siteIds: [UI_FIXTURE.montroseSiteId] },
        },
        {
          id: "d",
          name: "finalize_plan",
          args: {
            comparisonId: UI_FIXTURE.foreignComparisonId,
            chosenSiteId: UI_FIXTURE.montroseSiteId,
            rationale: "Best fit.",
          },
        },
        {
          id: "e",
          name: "focus_map",
          args: { siteIds: [UI_FIXTURE.montroseSiteId, "L-fake:S-9"] },
        },
      ]),
      new AIMessage("I couldn't find those."),
    ]);
    const { actions, reply } = runWithUi(model, "open everything", {
      city: "Houston",
    });
    await reply;
    expect(actions).toEqual([]);
    const results = toolResults(model);
    expect(results).toHaveLength(5);
    expect(results.every((text) => text.startsWith("Error:"))).toBe(true);
    expect(results.join(" ")).toContain("not in Houston");
    // Without a view, no candidate can be presented; without a results port nothing finalizes.
    expect(results.join(" ")).toContain("not one of the founder's candidates");
    expect(results.join(" ")).toContain("cannot be read right now");
  });

  it("caps UI actions at three per turn and keeps them when the step budget runs out", async () => {
    const targets = ["map", "candidate_list", "site_summary", "assumptions"];
    const model = new ScriptedModel(
      Array.from({ length: 20 }, (_, index) =>
        uiCall([
          {
            id: `h-${index}`,
            name: "highlight",
            args: { target: targets[index % targets.length] },
          },
        ]),
      ),
    );
    const { actions, reply } = runWithUi(model, "point at things");
    expect(await reply).toContain("business name");
    expect(actions.map((action) => action.type)).toEqual([
      "highlight",
      "highlight",
      "highlight",
    ]);
    expect(String(model.calls.at(-1)?.at(-1)?.content)).toMatch(
      /limit \(3\) reached|Already queued/,
    );
  });

  it("reports invalid arguments as tool errors instead of failing the run", async () => {
    const model = new ScriptedModel([
      uiCall([
        { id: "a", name: "highlight", args: { target: "#root" } },
        {
          id: "b",
          name: "set_site_tweaks",
          args: { candidateId: UI_FIXTURE.montroseSiteId, tweaks: {} },
        },
      ]),
      new AIMessage("Sorry."),
    ]);
    const { actions, reply } = runWithUi(model, "highlight the root");
    expect(await reply).toBe("Sorry.");
    expect(actions).toEqual([]);
    // LangChain rejects schema-invalid arguments; the executor rejects an empty tweak.
    const [badTarget, noTweak] = toolResults(model);
    expect(badTarget).toMatch(/^Error/);
    expect(noTweak).toContain("No changes given");
  });
});

it("HAC-149 includes only the bounded validated view line and logs its size", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { resolveViewContext, formatViewContext } =
    await import("./view-context");
  const view = await resolveViewContext(
    "project-1",
    { stage: "site", siteId: "screen", candidateIds: ["screen", "cheap"] },
    {
      comparison: async () => null,
      scenario: async () => null,
      investigation: async () => null,
      candidates: async () => ["screen", "cheap"],
    },
  );
  const line = formatViewContext(view!);
  const model = new ScriptedModel([new AIMessage("Compare screen with cheap")]);
  const reply = await createDeepIntakeRunner(model)({
    session: createIntakeSession("project-1"),
    message: "Compare this one with the cheapest",
    signal: new AbortController().signal,
    viewContextLine: line,
  });
  expect(reply).toBe("Compare screen with cheap");
  const messages = model.calls[0]
    .map((message) => String(message.content))
    .join("\n");
  expect(messages).toContain(line);
  expect(messages).not.toContain("Founder's screen");
  const entries = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
  expect(entries.at(-1)).toMatchObject({
    viewContextBytes: new TextEncoder().encode(line).length,
  });
  expect(JSON.stringify(entries)).not.toContain("screen");
});
