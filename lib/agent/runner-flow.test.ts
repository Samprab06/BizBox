import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import {
  FLOW_STEP_IDS,
  type AgentViewContext,
  type FlowEvent,
  type UiAction,
} from "@/lib/contracts/agent";
import { fixture } from "./__fixtures__/plan";
import { founderAnswers } from "./__fixtures__/founder";
import { ScriptedModel } from "./__fixtures__/scripted-model";
import { orderUiActions, type ComparisonResultsPort } from "./flow-tools";
import { createIntakeSession } from "./intake";
import type { JobsPort } from "./job-tools";
import { createDeepIntakeRunner, FLOW_INSTRUCTIONS } from "./runner";
import type { IntakeUiLookups } from "./ui-tools";
import { formatViewContext } from "./view-context";

vi.mock("server-only", () => ({}));

const { projectId: PROJECT, comparison: COMPARISON } = fixture();
const SITES = ["101:1", "102:2", "103:3", "site-a", "site-b"];
const lookups: IntakeUiLookups = {
  async site(id) {
    return SITES.includes(id) ? { city: "Houston" } : null;
  },
  async comparisonExists() {
    return true;
  },
  async investigationExists() {
    return true;
  },
};
const jobs: JobsPort = {
  saveProfile: async () => ({ id: "profile_1" }),
  startInvestigation: async () => ({ status: "started", investigationId: "inv_1" }),
};
const results: ComparisonResultsPort = {
  async load(projectId, id) {
    return projectId === PROJECT && id === COMPARISON.id ? COMPARISON : null;
  },
};
const VIEW: AgentViewContext = {
  stage: "workspace",
  step: "locations",
  candidates: [
    { id: "101:1", address: "101 Main St", monthlyRentUsd: 7200, sqft: 1800 },
    { id: "102:2", address: "22 Westheimer Rd", monthlyRentUsd: 2400, sqft: 1300 },
    { id: "103:3", address: "9 Heights Blvd", sqft: 1500 },
  ],
};

function turn(
  model: ScriptedModel,
  input: { message?: string; event?: FlowEvent; view?: AgentViewContext },
) {
  const session = createIntakeSession(PROJECT);
  for (const answer of founderAnswers) session.saveProfile(answer);
  const actions: UiAction[] = [];
  let n = 0;
  const reply = createDeepIntakeRunner(model)({
    session,
    message: input.message ?? "",
    ...(input.event ? { event: input.event } : {}),
    signal: new AbortController().signal,
    viewContextLine: input.view ? formatViewContext(input.view) : undefined,
    ui: {
      projectId: PROJECT,
      lookups,
      view: input.view,
      jobs,
      results,
      actions,
      newId: () => `a${++n}`,
    },
  });
  return { reply, actions };
}
const firstUserMessage = (model: ScriptedModel) =>
  String(model.calls[0]?.at(-1)?.content);
const systemPrompt = (model: ScriptedModel) =>
  JSON.stringify(model.calls[0]?.[0]?.content);

describe("Scene 1 consultant prompt", () => {
  it("walks the founder through the five flow steps, in order", () => {
    let last = -1;
    FLOW_STEP_IDS.forEach((step, index) => {
      const at = FLOW_INSTRUCTIONS.indexOf(`${index + 1}. ${step}:`);
      expect(at).toBeGreaterThan(last);
      last = at;
    });
    expect(FLOW_INSTRUCTIONS).toContain("modeled estimate, not measured traffic");
    expect(FLOW_INSTRUCTIONS).toContain("Never invent numbers");
    expect(FLOW_INSTRUCTIONS).toContain("Always ask before running or rerunning");
    expect(FLOW_INSTRUCTIONS).toContain("never send the founder to other pages");
    for (const stage of ["Jev persona panel", "demand per site", "seeded days", "monthly economics"])
      expect(FLOW_INSTRUCTIONS).toContain(stage);
  });

  it("binds the flow and comparison tools on a founder message turn", async () => {
    const model = new ScriptedModel([new AIMessage("Hi!")]);
    await turn(model, { message: "hello", view: VIEW }).reply;
    expect(model.boundNames).toEqual([
      "save_profile",
      "open_site",
      "focus_map",
      "highlight",
      "present_top_sites",
      "set_site_tweaks",
      "go_to_step",
      "read_comparison_results",
      "finalize_plan",
      "set_shortlist",
      "run_comparison",
    ]);
    expect(systemPrompt(model)).toContain("1. questions:");
    expect(firstUserMessage(model)).toContain("Founder says:\nhello");
  });

  it('"yes, compare them" sets the shortlist, runs it and moves to compare', async () => {
    const top = ["101:1", "102:2", "103:3"];
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "1", name: "set_shortlist", args: { siteIds: top } },
          { id: "2", name: "run_comparison", args: {} },
          { id: "3", name: "go_to_step", args: { step: "compare" } },
        ],
      }),
      new AIMessage("Running the comparison now; it can take a few minutes."),
    ]);
    const { reply, actions } = turn(model, { message: "yes, compare them", view: VIEW });
    expect(await reply).toContain("Running");
    // Parallel calls finish in any order; the reply applies them in a fixed one.
    expect(
      orderUiActions(actions).map(({ id: _id, ...action }) => {
        void _id;
        return action;
      }),
    ).toEqual([
      { type: "set_shortlist", siteIds: top },
      { type: "run_comparison", siteIds: top },
      { type: "go_to_step", step: "compare" },
    ]);
  });
});

describe("Scene 1 flow event turns", () => {
  it("arrived_workspace: presents the top three from the view, as a browser event", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "1",
            name: "present_top_sites",
            args: { siteIds: ["101:1", "102:2", "103:3"] },
          },
        ],
      }),
      new AIMessage("Here are your top three. Shall I compare them?"),
    ]);
    const { reply, actions } = turn(model, {
      event: { kind: "arrived_workspace" },
      view: VIEW,
    });
    expect(await reply).toContain("top three");
    expect(actions).toEqual([
      { id: "a1", type: "present_top_sites", siteIds: ["101:1", "102:2", "103:3"] },
    ]);
    const message = firstUserMessage(model);
    expect(message).toContain("[flow event] arrived_workspace");
    expect(message).toContain("not a message from the founder");
    expect(message).not.toContain("Founder says");
    // The model sees the candidates' facts.
    expect(message).toContain("101 Main St");
    expect(message).toContain('"monthlyRentUsd":7200');
    // Nothing that runs, tweaks, finalizes or saves is bound on an event turn.
    expect(model.boundNames).toEqual([
      "open_site",
      "focus_map",
      "highlight",
      "present_top_sites",
      "go_to_step",
      "read_comparison_results",
    ]);
    expect(systemPrompt(model)).toContain("never counts as their agreement");
  });

  it("comparison_progress: asks for one or two sentences on the current stage", async () => {
    const model = new ScriptedModel([
      new AIMessage("About a third done: the panel answers become demand per site."),
    ]);
    const { reply, actions } = turn(model, {
      event: { kind: "comparison_progress", completed: 120, total: 400 },
    });
    expect(await reply).toContain("demand per site");
    expect(actions).toEqual([]);
    expect(firstUserMessage(model)).toContain(
      "[flow event] comparison_progress 120/400 (30%)",
    );
    expect(firstUserMessage(model)).toContain("one or two sentences");
  });

  it("comparison_finished: reads the stored results into the note, then moves to results", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "1", name: "go_to_step", args: { step: "results" } },
          { id: "2", name: "highlight", args: { target: "comparison_table" } },
        ],
      }),
      new AIMessage("site-a leads with about $1,500 a month in modeled contribution."),
    ]);
    const { reply, actions } = turn(model, {
      event: { kind: "comparison_finished", comparisonId: COMPARISON.id },
    });
    expect(await reply).toContain("modeled contribution");
    expect(actions.map((a) => a.type)).toEqual(["go_to_step", "highlight"]);
    const message = firstUserMessage(model);
    expect(message).toContain("Comparison results (modeled estimates over 2 seeded scenarios");
    expect(message).toContain('"siteId":"site-a"');
    // Only one model call was needed for the results, plus the reply.
    expect(model.calls).toHaveLength(2);
  });

  it("comparison_finished for another project's comparison carries the refusal, not data", async () => {
    const model = new ScriptedModel([new AIMessage("It finished.")]);
    await turn(model, {
      event: { kind: "comparison_finished", comparisonId: "cmp_foreign" },
    }).reply;
    const message = firstUserMessage(model);
    expect(message).toContain("does not belong to this project");
    expect(message).not.toContain('"siteId":"site-a"');
  });

  it("returns an empty reply when the model says nothing, for the handler to fill", async () => {
    const model = new ScriptedModel([new AIMessage("")]);
    expect(
      await turn(model, { event: { kind: "comparison_failed" } }).reply,
    ).toBe("");
  });
});
