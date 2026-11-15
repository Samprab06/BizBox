import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { UiAction } from "@/lib/contracts/agent";
import { ScriptedModel } from "./__fixtures__/scripted-model";
import { founderAnswers } from "./__fixtures__/founder";
import {
  createJobsPort,
  createJobToolExecutor,
  FLOW_JOB_TOOL_NAMES,
  MAX_INVESTIGATION_STARTS_PER_DAY,
  type InvestigationCounts,
  type JobsPort,
} from "./job-tools";
import { createIntakeSession } from "./intake";
import { createDeepIntakeRunner } from "./runner";
import type { IntakeUiLookups } from "./ui-tools";

vi.mock("server-only", () => ({}));

const PROJECT = "project-1";
const SITES = ["101:1", "102:2", "103:3", "104:4"];
const lookups: IntakeUiLookups = {
  async site(id) {
    return SITES.includes(id) ? { city: "Houston" } : null;
  },
  async comparisonExists(projectId, id) {
    return projectId === PROJECT && id === "cmp_1";
  },
  async investigationExists() {
    return true;
  },
};
const calls = (
  list: { name: string; args: Record<string, unknown>; id: string }[],
) => new AIMessage({ content: "", tool_calls: list });
const toolResults = (model: ScriptedModel) =>
  model.calls.at(-1)!.flatMap((m) => (m.type === "tool" ? [String(m.content)] : []));

function fakePort(over: Partial<JobsPort> = {}) {
  const started: unknown[] = [];
  const port: JobsPort = {
    saveProfile: vi.fn(async () => ({ id: "profile_1" })),
    startInvestigation: vi.fn(async (input) => {
      started.push(input);
      return { status: "started" as const, investigationId: "inv_1" };
    }),
    ...over,
  };
  return { port, started };
}
function setup(
  model: ScriptedModel,
  options: {
    complete?: boolean;
    port?: JobsPort;
    view?: object;
  } = {},
) {
  const session = createIntakeSession(PROJECT);
  for (const answer of options.complete === false ? [] : founderAnswers)
    session.saveProfile(answer);
  const actions: UiAction[] = [];
  let n = 0;
  const reply = createDeepIntakeRunner(model)({
    session,
    message: "go",
    signal: new AbortController().signal,
    ui: {
      projectId: PROJECT,
      lookups,
      view: options.view as never,
      jobs: options.port ?? fakePort().port,
      actions,
      newId: () => `a${++n}`,
    },
  });
  return { actions, reply };
}

describe("jobs tool group (HAC-151)", () => {
  it("is bound only with a jobs port, after the ui and flow tools", async () => {
    const model = new ScriptedModel([new AIMessage("hi")]);
    await setup(model).reply;
    expect(model.boundNames.slice(-FLOW_JOB_TOOL_NAMES.length)).toEqual([
      ...FLOW_JOB_TOOL_NAMES,
    ]);
    expect(FLOW_JOB_TOOL_NAMES).toEqual(["set_shortlist", "run_comparison"]);
  });

  it('"compare my top three" sets the shortlist then runs the comparison', async () => {
    const top = SITES.slice(0, 3);
    const model = new ScriptedModel([
      calls([
        { id: "1", name: "set_shortlist", args: { siteIds: top } },
        { id: "2", name: "run_comparison", args: {} },
      ]),
      new AIMessage("Comparing your top three now."),
    ]);
    const { actions, reply } = setup(model);
    expect(await reply).toContain("top three");
    expect(actions.map((a) => a.type)).toEqual(["set_shortlist", "run_comparison"]);
    expect(actions[0]).toMatchObject({ siteIds: top });
    expect(actions[1]).toMatchObject({ siteIds: top });
  });

  it("repeating a tool in the same turn has no extra effect", async () => {
    const model = new ScriptedModel([
      calls([
        { id: "1", name: "set_shortlist", args: { siteIds: SITES.slice(0, 2) } },
        { id: "2", name: "set_shortlist", args: { siteIds: SITES.slice(0, 2) } },
        { id: "3", name: "run_comparison", args: {} },
        { id: "4", name: "run_comparison", args: {} },
      ]),
      new AIMessage("ok"),
    ]);
    const { actions, reply } = setup(model);
    await reply;
    expect(actions).toHaveLength(2);
    expect(toolResults(model).filter((r) => r.startsWith("Already done"))).toHaveLength(2);
  });

  it("rejects unknown sites and an incomplete profile without queueing anything", async () => {
    const model = new ScriptedModel([
      calls([
        { id: "1", name: "set_shortlist", args: { siteIds: ["999:9"] } },
        { id: "2", name: "run_comparison", args: { siteIds: ["101:1"] } },
      ]),
      new AIMessage("sorry"),
    ]);
    const { actions, reply } = setup(model, { complete: false });
    await reply;
    expect(actions).toEqual([]);
    const results = toolResults(model);
    expect(results[0]).toContain("Unknown site ID 999:9");
    expect(results[1]).toContain("profile is not complete");
  });

  it("caps the comparison at three units and falls back to the view's shortlist", async () => {
    const model = new ScriptedModel([
      calls([
        { id: "1", name: "set_shortlist", args: { siteIds: SITES } },
        { id: "2", name: "run_comparison", args: {} },
      ]),
      new AIMessage("ok"),
    ]);
    const { actions, reply } = setup(model, {
      view: { stage: "workspace", candidateIds: SITES, shortlistIds: [SITES[3]!, SITES[1]!] },
    });
    await reply;
    // Four sites is over MAX_COMPARE_UNITS, so the shortlist is refused...
    expect(toolResults(model)[0]).toMatch(/did not match expected schema/);
    // ...and run_comparison uses the view's shortlist rather than all candidates.
    expect(actions).toEqual([
      { id: "a1", type: "run_comparison", siteIds: [SITES[3], SITES[1]] },
    ]);
  });

  it("binds only set_shortlist and run_comparison of the job tools", async () => {
    const model = new ScriptedModel([new AIMessage("hi")]);
    await setup(model).reply;
    expect(model.boundNames).not.toContain("start_investigation");
    expect(model.boundNames).not.toContain("open_plan");
  });
});

/** The unbound legacy job tools still validate as before when called directly. */
describe("legacy job tools (executor only)", () => {
  function direct(options: { complete?: boolean; port?: JobsPort; view?: object } = {}) {
    const session = createIntakeSession(PROJECT);
    for (const answer of options.complete === false ? [] : founderAnswers)
      session.saveProfile(answer);
    const actions: UiAction[] = [];
    let n = 0;
    const run = createJobToolExecutor(
      {
        projectId: PROJECT,
        lookups,
        view: options.view as never,
        jobs: options.port ?? fakePort().port,
        actions,
        newId: () => `a${++n}`,
      },
      {
        profile: () => session.snapshot().profile,
        missing: () => session.snapshot().missingRequiredFields,
        draftCity: () => session.snapshot().draft.city,
      },
    );
    return { run, actions };
  }

  it("start_investigation needs a complete profile and lists what is missing", async () => {
    const { port } = fakePort();
    const { run, actions } = direct({ complete: false, port });
    expect(await run("start_investigation", {})).toContain("Missing:");
    expect(port.saveProfile).not.toHaveBeenCalled();
    expect(port.startInvestigation).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it("start_investigation persists the profile once, creates the job and shows it", async () => {
    const { port, started } = fakePort();
    const { run, actions } = direct({ port });
    await Promise.all([run("start_investigation", {}), run("start_investigation", {})]);
    expect(port.saveProfile).toHaveBeenCalledTimes(1);
    expect(started).toEqual([
      expect.objectContaining({ projectId: PROJECT, profileId: "profile_1" }),
    ]);
    expect(actions).toEqual([
      { id: "a1", type: "show_comparison", investigationId: "inv_1" },
    ]);
  });

  it("reports the daily limit as a tool error and shows an active job", async () => {
    const limited = direct({
      port: fakePort({
        startInvestigation: async () => ({ status: "daily_limit" as const, limit: 3 }),
      }).port,
    });
    expect(await limited.run("start_investigation", {})).toContain("daily limit of 3");
    expect(limited.actions).toEqual([]);
    const active = direct({
      port: fakePort({
        startInvestigation: async () => ({
          status: "active" as const,
          investigationId: "inv_old",
        }),
      }).port,
    });
    await active.run("start_investigation", {});
    expect(active.actions).toEqual([
      { id: "a1", type: "show_comparison", investigationId: "inv_old" },
    ]);
  });

  it("open_plan uses the screen's comparison and checks it belongs to the project", async () => {
    const a = direct({ view: { stage: "comparison", comparisonId: "cmp_1" } });
    await a.run("open_plan", {});
    expect(a.actions).toEqual([{ id: "a1", type: "show_plan", comparisonId: "cmp_1" }]);
    const b = direct({ view: { stage: "comparison", comparisonId: "cmp_x" } });
    expect(await b.run("open_plan", {})).toContain("does not belong");
    expect(b.actions).toEqual([]);
  });
});

describe("createJobsPort caps", () => {
  const make = (counts: InvestigationCounts, now = new Date("2026-11-15T12:00:00Z")) => {
    const create = vi.fn(async () => ({ id: `inv_${create.mock.calls.length}` }));
    const port = createJobsPort({
      profiles: { saveSnapshot: async () => null },
      create,
      counts,
      now: () => now,
    });
    return { port, create };
  };
  const input = { projectId: PROJECT, profileId: "p", question: "q" };

  it("allows one active investigation per project", async () => {
    const { port, create } = make({
      activeFor: async () => "inv_running",
      startsSince: async () => 0,
    });
    expect(await port.startInvestigation(input)).toEqual({
      status: "active",
      investigationId: "inv_running",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("stops at the daily cap, counted over the last 24 hours", async () => {
    let since: Date | undefined;
    const { port, create } = make({
      activeFor: async () => null,
      startsSince: async (_p, date) => {
        since = date;
        return MAX_INVESTIGATION_STARTS_PER_DAY;
      },
    });
    expect(await port.startInvestigation(input)).toEqual({
      status: "daily_limit",
      limit: MAX_INVESTIGATION_STARTS_PER_DAY,
    });
    expect(create).not.toHaveBeenCalled();
    expect(since?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
  });

  it("serialises parallel starts so only one is created", async () => {
    let active: string | null = null;
    const { port, create } = make({
      activeFor: async () => active,
      startsSince: async () => 0,
    });
    create.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      active = "inv_new";
      return { id: "inv_new" };
    });
    const [a, b] = await Promise.all([
      port.startInvestigation(input),
      port.startInvestigation(input),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(["active", "started"]);
  });
});
