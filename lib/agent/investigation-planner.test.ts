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

  it("routes a configured planner decision to an OpenAI-compatible base URL", async () => {
    const f = setup();
    const job = await create(f);
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        id: "chatcmpl-planner-test", object: "chat.completion", created: 1,
        model: "glm-5.3-flash-free",
        choices: [{ index: 0, finish_reason: "tool_calls", message: {
          role: "assistant", content: null, tool_calls: [{
            id: "decision-test", type: "function", function: {
              name: "InvestigationDecision", arguments: JSON.stringify(decision("finish")),
            },
          }],
        } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }));
    try {
      const planner = createConfiguredInvestigationPlanner(f.tools, {
        OPENAI_API_KEY: "test-provider-key",
        OPENAI_BASE_URL: "https://opencode.ai/inference/openai/v1",
        OPENAI_MODEL: "glm-5.3-flash-free",
      }, { now: f.now });
      const step = await planner(plannerInput(job));
      expect(step?.tool).toBe("finish_investigation");
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
      expect((await requests[0]!.json()).model).toBe("glm-5.3-flash-free");
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("Nessie planner workflow", () => {
  it("accepts a cash tool decision, checkpoints it once and preserves its finding on finish", async () => {
    const f = setup();
    f.tools.definitions.push({
      name: "read_nessie_cash_buffer",
      description: "Read simulated demo cash",
      schema: z.object({}).strict(),
    });
    f.execute.mockImplementation(async () => {
      f.elapse(100);
      return {
        summary: {
          kind: "nessie_cash_buffer",
          source: "nessie",
          synthetic: true,
          status: "empty",
        },
        findings: [
          "Nessie shared simulated sandbox has no cash accounts; affordability is unverified.",
        ],
      };
    });
    const job = await f.service.create({
      projectId: "project-1",
      profileId: "profile-1",
      question: "Can we afford opening the shop with our cash buffer?",
    });
    const prompts: string[] = [];
    let call = 0;
    const planner = createInvestigationPlanner({
      tools: f.tools,
      now: f.now,
      choose: async ({ prompt }) => {
        prompts.push(prompt);
        return ++call <= 2
          ? {
              tool: "read_nessie_cash_buffer",
              argsJson: "{}",
              findings: [],
              done: false,
            }
          : {
              tool: "finish",
              argsJson: "{}",
              findings: [
                "Cash affordability remains unverified because Nessie has no accounts.",
              ],
              done: true,
            };
      },
    });
    const first = await f.service.advance(job.id, planner, {
      maxDurationMs: 100,
    });
    expect(["queued", "running"]).toContain(first.status);
    expect(first.counters.toolCalls).toBe(1);
    const saved = await f.repository.listMilestones(job.id, 1);
    expect(saved[0]?.tool).toBe("read_nessie_cash_buffer");
    expect(saved[0]?.summary).toMatchObject({
      output: { kind: "nessie_cash_buffer", status: "empty" },
      toolFindings: [
        "Nessie shared simulated sandbox has no cash accounts; affordability is unverified.",
      ],
    });
    const resumed = await f.service.advance(job.id, planner, {});
    expect(resumed.status).toBe("succeeded");
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(resumed.findings.join(" ")).toContain("affordability is unverified");
    expect(prompts.at(-1)).toContain("already completed");
  });
});

it("withholds superseded cash and derived model prose from a ready-to-provider-error planning context", async () => {
  const f = setup();
  const job = await create(f);
  const identity = {
    kind: "nessie_cash_buffer",
    source: "nessie",
    synthetic: true,
    investigationId: job.id,
    attempt: job.attempt,
    projectId: job.projectId,
    profileId: job.profileId,
    profileVersion: 1,
  };
  const ready = {
    ...identity,
    status: "ready",
    message: "OLD_CASH_MESSAGE",
    accounts: [
      {
        id: "acct_a",
        nickname: "Demo",
        type: "Checking",
        balanceCents: 123456789,
        availableCents: 123456789,
      },
    ],
    selectedAccount: {
      id: "acct_a",
      nickname: "Demo",
      type: "Checking",
      balanceCents: 123456789,
      availableCents: 123456789,
    },
    snapshot: {
      accountId: "acct_a",
      asOf: "2026-11-14T17:00:00.000Z",
      windowStart: "2026-10-15T17:00:00.000Z",
      windowEnd: "2026-11-14T17:00:00.000Z",
      windowDays: 30,
      inflowCents: 0,
      outflowCents: 0,
      netCashFlowCents: 0,
      completedTransactionCount: 0,
      excludedTransfersCount: 0,
      upcomingBillsCents: 0,
    },
    scenario: null,
  };
  const failed = {
    ...identity,
    status: "provider_error",
    message: "LATEST_BANK_UNAVAILABLE",
    accounts: [],
    selectedAccount: null,
    snapshot: null,
    scenario: null,
  };
  const milestone = (
    seq: number,
    tool: string,
    summary: unknown,
  ): InvestigationMilestone => ({
    investigationId: job.id,
    attempt: job.attempt,
    seq,
    tool,
    inputHash: `hash-${seq}`,
    createdAt: f.now().toISOString(),
    summary: summary as InvestigationMilestone["summary"],
  });
  const milestones = [
    milestone(0, "search_sites", {
      toolFindings: ["Useful location evidence"],
    }),
    milestone(1, "read_nessie_cash_buffer", {
      input: {},
      output: ready,
      toolFindings: ["OLD_CASH_ARITHMETIC"],
      modelFindings: ["OLD_MODEL_REASSURANCE"],
    }),
    milestone(2, "get_site_run", {
      output: {},
      toolFindings: ["Useful queue evidence"],
      modelFindings: ["MODEL_USED_OLD_CASH"],
    }),
    milestone(3, "read_nessie_cash_buffer", {
      input: {},
      output: failed,
      toolFindings: [failed.message],
      modelFindings: ["LATEST_MODEL_BANK_NOTE"],
    }),
  ];
  job.findings = [
    "Useful location evidence",
    "Useful queue evidence",
    "OLD_CASH_MESSAGE",
    "OLD_CASH_ARITHMETIC",
    "OLD_MODEL_REASSURANCE",
    "MODEL_USED_OLD_CASH",
    "LATEST_MODEL_BANK_NOTE",
    failed.message,
  ];
  let prompt = "";
  const planner = createInvestigationPlanner({
    tools: f.tools,
    now: f.now,
    choose: async (input) => {
      prompt = input.prompt;
      return decision("finish");
    },
  });
  await planner(plannerInput(job, milestones));
  for (const old of [
    "OLD_CASH",
    "OLD_MODEL",
    "MODEL_USED_OLD_CASH",
    "LATEST_MODEL_BANK_NOTE",
    "123456789",
  ])
    expect(prompt).not.toContain(old);
  expect(prompt).toContain("Useful location evidence");
  expect(prompt).toContain("Useful queue evidence");
  expect(prompt).toContain(failed.message);
  const history = JSON.parse(prompt).completedMilestones;
  expect(history.find((m: { seq: number }) => m.seq === 1)).toMatchObject({
    seq: 1,
    tool: "read_nessie_cash_buffer",
    inputHash: "hash-1",
  });
});
