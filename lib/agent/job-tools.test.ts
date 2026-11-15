import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { UiAction } from "@/lib/contracts/agent";
import { ScriptedModel } from "./__fixtures__/scripted-model";
import { founderAnswers } from "./__fixtures__/founder";
import {
  createJobsPort,
  JOB_TOOL_NAMES,
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
const call = (name: string, args: Record<string, unknown>, id = name) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args }] });
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
  it("is bound only with a jobs port, after the ui tools", async () => {
    const model = new ScriptedModel([new AIMessage("hi")]);
    await setup(model).reply;
    expect(model.boundNames.slice(-JOB_TOOL_NAMES.length)).toEqual([
      ...JOB_TOOL_NAMES,
    ]);
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

  it("start_investigation needs a complete profile and lists what is missing", async () => {
    const { port } = fakePort();
    const model = new ScriptedModel([
      call("start_investigation", {}),
      new AIMessage("What is your city?"),
    ]);
    const { actions, reply } = setup(model, { complete: false, port });
    await reply;
    expect(port.saveProfile).not.toHaveBeenCalled();
    expect(port.startInvestigation).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
    expect(toolResults(model)[0]).toContain("Missing:");
  });

  it("start_investigation persists the profile once, creates the job and shows it", async () => {
    const { port, started } = fakePort();
    const model = new ScriptedModel([
      calls([
        { id: "1", name: "start_investigation", args: {} },
        { id: "2", name: "start_investigation", args: {} },
      ]),
      new AIMessage("Started."),
    ]);
    const { actions, reply } = setup(model, { port });
    await reply;
    expect(port.saveProfile).toHaveBeenCalledTimes(1);
    expect(started).toEqual([
      expect.objectContaining({ projectId: PROJECT, profileId: "profile_1" }),
    ]);
    expect(actions).toEqual([
      { id: "a1", type: "show_comparison", investigationId: "inv_1" },
    ]);
  });

  it("reports an active job or the daily limit as a tool error", async () => {
    for (const status of [
      { status: "daily_limit" as const, limit: 3 },
    ]) {
      const { port } = fakePort({ startInvestigation: async () => status });
      const model = new ScriptedModel([
        call("start_investigation", {}),
        new AIMessage("Limit reached."),
      ]);
      const { actions, reply } = setup(model, { port });
      await reply;
      expect(actions).toEqual([]);
      expect(toolResults(model)[0]).toContain("daily limit of 3");
    }
    const { port } = fakePort({
      startInvestigation: async () => ({
        status: "active" as const,
        investigationId: "inv_old",
      }),
    });
    const model = new ScriptedModel([
      call("start_investigation", {}),
      new AIMessage("Already running."),
    ]);
    const { actions, reply } = setup(model, { port });
    await reply;
    expect(actions).toEqual([
      { id: "a1", type: "show_comparison", investigationId: "inv_old" },
    ]);
  });

  it("open_plan uses the screen's comparison and checks it belongs to the project", async () => {
    const own = new ScriptedModel([call("open_plan", {}), new AIMessage("Plan.")]);
    const a = setup(own, { view: { stage: "comparison", comparisonId: "cmp_1" } });
    await a.reply;
    expect(a.actions).toEqual([{ id: "a1", type: "show_plan", comparisonId: "cmp_1" }]);
    const foreign = new ScriptedModel([call("open_plan", {}), new AIMessage("No.")]);
    const b = setup(foreign, { view: { stage: "comparison", comparisonId: "cmp_x" } });
    await b.reply;
    expect(b.actions).toEqual([]);
    expect(toolResults(foreign)[0]).toContain("does not belong");
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
