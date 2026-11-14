import { AIMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GroundedLocationPlan } from "@/lib/contracts/plan";
import {
  createInvestigationService,
  type InvestigationJob,
  type InvestigationMilestone,
} from "./jobs";
import { createMemoryInvestigationRepository } from "./jobs-memory";
import type { InvestigationToolName, InvestigationToolRegistry } from "./tools";
import {
  createConfiguredInvestigationPlanner,
  createDeepInvestigationDecisionModel,
  createInvestigationPlanner,
  investigationInputHash,
  type InvestigationDecision,
  type InvestigationDecisionInput,
} from "./investigation-planner";

vi.mock("server-only", () => ({}));
const names: InvestigationToolName[] = [
  "save_profile",
  "search_sites",
  "get_catchment",
  "poll_customers",
  "evaluate_sites",
  "run_sensitivity",
  "get_site_run",
];
const decision = (
  tool: InvestigationDecision["tool"],
  step = "x",
): InvestigationDecision => ({
  tool,
  argsJson: tool === "finish" ? "{}" : JSON.stringify({ step }),
  findings:
    tool === "finish"
      ? ["Complete: compare seeded ranges and cite the returned evidence IDs."]
      : [],
  done: tool === "finish",
});
function setup() {
  let time = Date.parse("2026-11-14T12:00:00Z");
  const now = () => new Date(time);
  const repository = createMemoryInvestigationRepository({ now });
  const service = createInvestigationService(repository, {
    now,
    id: () => "job-1",
  });
  const execute = vi.fn<InvestigationToolRegistry["execute"]>(async (name) => ({
    summary: { artifactId: `${name}-artifact` },
  }));
  const tools: InvestigationToolRegistry = {
    definitions: names.map((name) => ({
      name,
      description: name,
      schema: z.object({ step: z.string() }).strict(),
    })),
    execute,
  };
  return {
    now,
    repository,
    service,
    tools,
    execute,
    elapse: (ms: number) => {
      time += ms;
    },
  };
}
const create = (f: ReturnType<typeof setup>) =>
  f.service.create({
    projectId: "project-1",
    profileId: "profile-1",
    question: "Compare three sites using scenario ranges.",
  });
const plannerInput = (
  job: InvestigationJob,
  milestones: InvestigationMilestone[] = [],
) => ({
  job,
  milestones,
  nextSeq: milestones.length,
  signal: new AbortController().signal,
});

describe("trusted investigation planner", () => {
  it("persists the deterministic final plan without a second model decision", async () => {
    const f = setup();
    const job = await create(f);
    const locationPlan: GroundedLocationPlan = {
      plan: {
        id: "plan-1",
        projectId: job.projectId,
        synthetic: true,
        profileId: job.profileId,
        comparisonId: "comparison-1",
        recommendedSiteId: null,
        recommendation: "Budget is unknown.",
        conditions: [],
        nextSteps: ["Validate evidence."],
        evidenceIds: ["comparison-1"],
        outputKind: "scenario_recommendation",
        notSalesForecast: true,
      },
      status: "budget_unknown",
      runnerUpSiteId: null,
      tiedSiteIds: [],
      why: [],
      leaseTargets: [],
      staffingAndStations: [],
      buildoutBudget: [],
      firstNinetyDays: [],
      assumptions: [],
      sensitivity: [],
      findings: [],
      facts: [],
      narrative: null,
      demand: {
        requested: "huff",
        actual: "huff",
        fallbackReason: null,
        huffAgreement: "not_independent",
        reference: {
          comparisonId: "comparison-1",
          metric: "demandSourceCheck",
        },
      },
    };
    const choose = vi.fn(async () => decision("finish"));
    const finalizePlan = vi.fn(async () => locationPlan);
    const planner = createInvestigationPlanner({
      tools: f.tools,
      choose,
      finalizePlan,
      now: f.now,
    });
    const step = await planner(plannerInput(job));
    const result = await step!.execute({
      signal: new AbortController().signal,
      idempotencyKey: "finish",
    });
    expect(result.summary).toMatchObject({
      output: { locationPlan, handoff: "HAC-24" },
    });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(finalizePlan).toHaveBeenCalledTimes(1);
  });
  it("keeps verified tool findings separate from model findings for plan consumers", async () => {
    const f = setup();
    const job = await create(f);
    f.execute.mockResolvedValue({
      summary: { profileId: job.profileId },
      findings: ["Verified missing parking evidence."],
    });
    const planner = createInvestigationPlanner({
      tools: f.tools,
      now: f.now,
      choose: async () => ({
        ...decision("search_sites"),
        findings: ["Unverified model prose."],
      }),
    });
    const step = await planner(plannerInput(job));
    const result = await step!.execute({
      signal: new AbortController().signal,
      idempotencyKey: "search",
    });
    expect(result.summary).toMatchObject({
      toolFindings: ["Verified missing parking evidence."],
      modelFindings: ["Unverified model prose."],
    });
  });
  it("runs a complete scripted workflow through the real checkpoint service", async () => {
    const f = setup();
    const job = await create(f);
    const workflow: InvestigationDecision[] = [
      decision("search_sites"),
      decision("get_catchment"),
      decision("poll_customers"),
      decision("evaluate_sites"),
      decision("get_site_run"),
      decision("run_sensitivity", "rent"),
      decision("run_sensitivity", "market_share"),
      decision("finish"),
    ];
    const choose = vi.fn(
      async (input: InvestigationDecisionInput) => workflow[input.nextSeq],
    );
    const planner = createInvestigationPlanner({
      tools: f.tools,
      choose,
      now: f.now,
    });
    const completed = await f.service.advance(job.id, planner);
    expect(completed.status).toBe("succeeded");
    expect(completed.counters).toEqual({
      toolCalls: 8,
      pollCustomers: 1,
      evaluateSites: 1,
    });
    expect(f.execute.mock.calls.map(([name]) => name)).toEqual(
      workflow.slice(0, -1).map((d) => d.tool),
    );
    const milestones = await f.repository.listMilestones(job.id);
    expect(milestones).toHaveLength(8);
    expect(milestones[0]!.summary).toEqual({
      input: { step: "x" },
      output: { artifactId: "search_sites-artifact" },
      toolFindings: [],
      modelFindings: [],
    });
    expect(completed.findings).toContain(workflow.at(-1)!.findings[0]);
    expect(choose.mock.calls.at(-1)![0].prompt).toContain(
      "evaluate_sites-artifact",
    );
  });

  it("reconstructs completed milestones in a fresh planner and resumes only unfinished work", async () => {
    const f = setup();
    const job = await create(f);
    f.execute.mockImplementation(async (name) => {
      f.elapse(100);
      return { summary: { artifactId: name } };
    });
    const choose = vi.fn(async ({ nextSeq }: InvestigationDecisionInput) =>
      nextSeq === 0 ? decision("search_sites") : decision("finish"),
    );
    const first = await f.service.advance(
      job.id,
      createInvestigationPlanner({ tools: f.tools, choose, now: f.now }),
      { maxDurationMs: 100 },
    );
    expect(["queued", "running"]).toContain(first.status);
    expect(await f.repository.listMilestones(job.id)).toHaveLength(1);
    const finished = await f.service.advance(
      job.id,
      createInvestigationPlanner({ tools: f.tools, choose, now: f.now }),
    );
    expect(finished.status).toBe("succeeded");
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(choose.mock.calls[1]![0].milestones[0]!.tool).toBe("search_sites");
  });

  it("never executes during planning or replays a completed identical tool", async () => {
    const f = setup();
    const job = await create(f);
    const choose = vi.fn(async () => decision("search_sites"));
    const planner = createInvestigationPlanner({
      tools: f.tools,
      choose,
      now: f.now,
    });
    const first = await planner(plannerInput(job));
    expect(f.execute).not.toHaveBeenCalled();
    const result = await first!.execute({
      signal: new AbortController().signal,
      idempotencyKey: "key-1",
    });
    const prior: InvestigationMilestone = {
      investigationId: job.id,
      attempt: 1,
      seq: 0,
      tool: first!.tool,
      inputHash: first!.inputHash,
      summary: result.summary,
      createdAt: f.now().toISOString(),
    };
    const duplicate = await planner(plannerInput(job, [prior]));
    expect(duplicate!.tool).toBe("finish_investigation");
    const done = await duplicate!.execute({
      signal: new AbortController().signal,
      idempotencyKey: "finish",
    });
    expect(done.done).toBe(true);
    expect(done.findings?.[0]).toMatch(/valid unfinished step/);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("allows the same search after a new profile snapshot, with a different idempotency hash", async () => {
    const f = setup();
    const job = await create(f);
    const planner = createInvestigationPlanner({
      tools: f.tools,
      choose: async () => decision("search_sites"),
      now: f.now,
    });
    const first = await planner(plannerInput(job));
    const milestone = (
      seq: number,
      tool: string,
      summary: InvestigationMilestone["summary"],
      hash: string,
    ): InvestigationMilestone => ({
      investigationId: job.id,
      attempt: 1,
      seq,
      tool,
      inputHash: hash,
      summary,
      createdAt: f.now().toISOString(),
    });
    const next = await planner(
      plannerInput(job, [
        milestone(
          0,
          first!.tool,
          { output: { profileId: "profile-1" } },
          first!.inputHash,
        ),
        milestone(
          1,
          "save_profile",
          { output: { profileId: "profile-2" } },
          "profile-save",
        ),
      ]),
    );
    expect(next!.tool).toBe("search_sites");
    expect(next!.inputHash).not.toBe(first!.inputHash);
  });

  it("stops with findings after bounded invalid decisions without executing a tool", async () => {
    const f = setup();
    const job = await create(f);
    const choose = vi.fn(async () => ({
      ...decision("search_sites"),
      argsJson: "{bad",
    }));
    const plan = await createInvestigationPlanner({
      tools: f.tools,
      choose,
      now: f.now,
    })(plannerInput(job));
    expect(choose).toHaveBeenCalledTimes(2);
    expect(f.execute).not.toHaveBeenCalled();
    expect(
      (
        await plan!.execute({
          signal: new AbortController().signal,
          idempotencyKey: "end",
        })
      ).done,
    ).toBe(true);
  });

  it("ends an expired investigation with findings and honors cancellation before model work", async () => {
    const f = setup();
    const job = await create(f);
    const choose = vi.fn();
    f.elapse(15 * 60_000);
    const planner = createInvestigationPlanner({
      tools: f.tools,
      choose,
      now: f.now,
    });
    const plan = await planner(plannerInput(job));
    expect(
      (
        await plan!.execute({
          signal: new AbortController().signal,
          idempotencyKey: "expired",
        })
      ).findings?.[0],
    ).toMatch(/wall-time/);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      planner({ ...plannerInput(job), signal: aborted.signal }),
    ).rejects.toThrow();
    expect(choose).not.toHaveBeenCalled();
  });

  it("uses stable key ordering for retry hashes while preserving array order", () => {
    expect(investigationInputHash("search_sites", { b: 2, a: [1, 2] })).toBe(
      investigationInputHash("search_sites", { a: [1, 2], b: 2 }),
    );
    expect(investigationInputHash("search_sites", { a: [1, 2] })).not.toBe(
      investigationInputHash("search_sites", { a: [2, 1] }),
    );
  });

  it("does not construct or call an unconfigured provider until a decision is requested", async () => {
    const f = setup();
    const job = await create(f);
    const planner = createConfiguredInvestigationPlanner(
      f.tools,
      {},
      { now: f.now },
    );
    await expect(planner(plannerInput(job))).rejects.toThrow("not configured");
    expect(f.execute).not.toHaveBeenCalled();
  });
});

class ScriptedDeepModel extends BaseChatModel {
  boundNames: string[] = [];
  calls = 0;
  constructor(private readonly response: InvestigationDecision) {
    super({});
  }
  _llmType() {
    return "investigation-scripted-model";
  }
  bindTools(tools: Parameters<NonNullable<BaseChatModel["bindTools"]>>[0]) {
    this.boundNames = tools.map((entry) => {
      if ("name" in entry) return String(entry.name);
      if (
        "function" in entry &&
        entry.function &&
        typeof entry.function === "object" &&
        "name" in entry.function
      )
        return String(entry.function.name);
      return "";
    });
    return this;
  }
  async _generate() {
    this.calls++;
    if (this.calls > 1) throw new Error("Unexpected additional model request");
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "decision-1",
          name: this.boundNames.at(-1)!,
          args: this.response,
        },
      ],
    });
    return { generations: [{ text: "", message }] };
  }
}

describe("real compiled deepagents decision graph", () => {
  it("returns a typed decision with no executable business, filesystem or delegation tools", async () => {
    const f = setup();
    const job = await create(f);
    const model = new ScriptedDeepModel(decision("search_sites"));
    const choose = createDeepInvestigationDecisionModel(model);
    const result = await choose({
      ...plannerInput(job),
      prompt: "Choose a search action.",
    });
    expect(result).toEqual(decision("search_sites"));
    expect(model.boundNames).toEqual(["InvestigationDecision"]);
    expect(model.calls).toBe(1);
    expect(f.execute).not.toHaveBeenCalled();
  });
});
