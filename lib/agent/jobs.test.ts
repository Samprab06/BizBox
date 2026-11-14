import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreateInvestigationSchema,
  InvestigationMilestoneSchema,
} from "@/lib/contracts/investigations";
import {
  createInvestigationService,
  type InvestigationStepPlanner,
} from "./jobs";
import { createMemoryInvestigationRepository } from "./jobs-memory";

function setup() {
  let time = Date.parse("2026-11-14T12:00:00Z");
  const now = () => new Date(time);
  const repository = createMemoryInvestigationRepository({ now });
  const service = createInvestigationService(repository, {
    now,
    id: () => "job-1",
  });
  return {
    repository,
    service,
    now,
    elapse: (ms: number) => {
      time += ms;
    },
  };
}
const input = {
  projectId: "project-1",
  profileId: "profile-1",
  question: "Which site?",
};
afterEach(() => vi.useRealTimers());

describe("durable investigation jobs", () => {
  it("checkpoints each completed step and resumes only unfinished work after cutoff", async () => {
    const f = setup();
    await f.service.create(input);
    const executed: string[] = [];
    const planner: InvestigationStepPlanner = async ({
      nextSeq,
      milestones,
    }) => {
      expect(milestones.map((m) => m.seq)).toEqual(
        Array.from({ length: nextSeq }, (_, i) => i),
      );
      if (nextSeq === 2) return null;
      return {
        tool: "inspect",
        inputHash: `hash-${nextSeq}`,
        execute: async ({ idempotencyKey }) => {
          executed.push(idempotencyKey);
          f.elapse(80);
          return {
            summary: { found: nextSeq },
            findings: [`Finding ${nextSeq}`],
          };
        },
      };
    };
    expect(
      (await f.service.advance("job-1", planner, { maxDurationMs: 100 }))
        .status,
    ).toBe("queued");
    expect(await f.repository.listMilestones("job-1")).toHaveLength(1);
    await f.service.advance("job-1", planner, { maxDurationMs: 100 });
    const final = await f.service.advance("job-1", planner, {
      maxDurationMs: 100,
    });
    expect(final.status).toBe("succeeded");
    expect(final.counters.toolCalls).toBe(2);
    expect(final.findings).toEqual(["Finding 0", "Finding 1"]);
    expect(executed).toEqual(["job-1:1:0:hash-0", "job-1:1:1:hash-1"]);
  });

  it("expires started queued/running jobs at five minutes, but not brand-new jobs", async () => {
    const f = setup();
    await f.service.create(input);
    f.elapse(300_000);
    expect((await f.service.load("job-1")).status).toBe("queued");
    await f.service.advance(
      "job-1",
      async () => ({
        tool: "inspect",
        inputHash: "h",
        execute: async () => {
          f.elapse(80);
          return { summary: null };
        },
      }),
      { maxDurationMs: 100 },
    );
    f.elapse(300_000);
    expect((await f.service.load("job-1")).status).toBe("interrupted");
    expect((await f.repository.load("job-1"))?.status).toBe("interrupted");
  });

  it("retries interrupted and failed jobs with a new attempt and preserves history/findings", async () => {
    const f = setup();
    await f.service.create(input);
    await f.service.advance("job-1", async ({ nextSeq }) => ({
      tool: "inspect",
      inputHash: String(nextSeq),
      execute: async () => {
        if (nextSeq === 1) throw new Error("private provider detail");
        return { summary: { ok: true }, findings: ["Useful"] };
      },
    }));
    const failed = await f.service.load("job-1");
    expect(failed.status).toBe("failed");
    expect(failed.reason).not.toContain("private");
    const retry = await f.service.retry("job-1");
    expect(retry).toMatchObject({
      status: "queued",
      attempt: 2,
      counters: { toolCalls: 0, pollCustomers: 0, evaluateSites: 0 },
      findings: ["Useful"],
    });
    expect(await f.repository.listMilestones("job-1", 1)).toHaveLength(1);
    await f.service.markInterrupted("job-1");
    expect((await f.service.retry("job-1")).attempt).toBe(3);
  });

  it.each([
    ["inspect", { toolCalls: 1 }, "toolCalls"],
    ["poll_customers", { pollCustomers: 1 }, "pollCustomers"],
    ["evaluate_sites", { evaluateSites: 1 }, "evaluateSites"],
  ] as const)(
    "stops %s before its configured limit is exceeded and keeps findings",
    async (tool, limits, counter) => {
      const f = setup();
      await f.service.create({ ...input, limits });
      const execute = vi.fn(async () => ({
        summary: { ok: true },
        findings: ["Useful finding"],
      }));
      const job = await f.service.advance("job-1", async () => ({
        tool,
        inputHash: "h",
        execute,
      }));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(job.status).toBe("succeeded");
      expect(job.reason).toContain(counter);
      expect(job.counters[counter]).toBe(1);
      expect(job.findings).toEqual(["Useful finding"]);
    },
  );

  it("fails at a zero limit without executing, and rejects caller-owned state or raised limits", async () => {
    const f = setup();
    expect(
      CreateInvestigationSchema.safeParse({ ...input, attempt: 9 }).success,
    ).toBe(false);
    expect(
      CreateInvestigationSchema.safeParse({ ...input, counters: {} }).success,
    ).toBe(false);
    expect(
      CreateInvestigationSchema.safeParse({
        ...input,
        limits: { toolCalls: 26 },
      }).success,
    ).toBe(false);
    await f.service.create({ ...input, limits: { toolCalls: 0 } });
    const execute = vi.fn();
    const job = await f.service.advance("job-1", async () => ({
      tool: "inspect",
      inputHash: "h",
      execute,
    }));
    expect(execute).not.toHaveBeenCalled();
    expect(job.status).toBe("failed");
  });

  it("persists cost reservations before execution and expires abandoned running work", async () => {
    const f = setup();
    const job = await f.service.create(input);
    await f.service.advance(job.id, async () => ({
      tool: "poll_customers",
      inputHash: "h",
      execute: async () => {
        expect((await f.repository.load(job.id))?.counters).toEqual({
          toolCalls: 1,
          pollCustomers: 1,
          evaluateSites: 0,
        });
        return { summary: null, done: true };
      },
    }));
    const acquired = await f.repository.acquire(job.id, "setup", f.now(), 5000);
    await f.repository.save(
      { ...acquired!, status: "running", lastAdvanceAt: f.now().toISOString() },
      "setup",
    );
    await f.repository.release(job.id, "setup");
    f.elapse(300_000);
    expect((await f.service.load(job.id)).status).toBe("interrupted");
  });

  it("atomically rejects duplicate milestones and cross-attempt checkpoints", async () => {
    const f = setup();
    const initial = await f.service.create(input);
    const job = await f.repository.acquire(initial.id, "owner", f.now(), 1000);
    const milestone = {
      investigationId: job!.id,
      attempt: 1,
      seq: 0,
      tool: "inspect",
      inputHash: "h",
      summary: null,
      createdAt: f.now().toISOString(),
    };
    const saved = await f.repository.save(job!, "owner", milestone);
    await expect(
      f.repository.save(saved, "owner", milestone),
    ).rejects.toMatchObject({ code: "lease_lost" });
    await expect(
      f.repository.save(saved, "owner", { ...milestone, attempt: 2, seq: 1 }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect((await f.repository.load(initial.id))?.revision).toBe(
      saved.revision,
    );
    expect(await f.repository.listMilestones(initial.id)).toHaveLength(1);
  });

  it("rejects concurrent advances while the current tool is running", async () => {
    const f = setup();
    await f.service.create(input);
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = f.service.advance("job-1", async () => ({
      tool: "inspect",
      inputHash: "h",
      execute: async () => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { summary: null, done: true };
      },
    }));
    await ready;
    await expect(
      f.service.advance("job-1", async () => null),
    ).rejects.toMatchObject({ code: "busy" });
    finish();
    expect((await first).status).toBe("succeeded");
  });

  it("fences expired owners and stale revisions, and never releases a successor lease", async () => {
    const f = setup();
    const original = await f.service.create(input);
    const old = await f.repository.acquire(original.id, "old", f.now(), 10);
    f.elapse(11);
    await expect(f.repository.save(old!, "old")).rejects.toMatchObject({
      code: "lease_lost",
    });
    const successor = await f.repository.acquire(
      original.id,
      "new",
      f.now(),
      100,
    );
    await expect(f.repository.save(old!, "old")).rejects.toMatchObject({
      code: "lease_lost",
    });
    await f.repository.release(original.id, "old");
    const saved = await f.repository.save(successor!, "new");
    expect(saved.revision).toBe(1);
    await expect(f.repository.save(successor!, "new")).rejects.toMatchObject({
      code: "lease_lost",
    });
  });

  it("aborts a hung executor at the budget, retains reservations, and prevents later checkpoints", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.service.create(input);
    let signal!: AbortSignal;
    let started!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const running = f.service.advance(
      "job-1",
      async () => ({
        tool: "inspect",
        inputHash: "h",
        execute: async (ctx) => {
          signal = ctx.signal;
          started();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { summary: { late: true }, findings: ["Late"] };
        },
      }),
      { maxDurationMs: 100 },
    );
    await ready;
    await vi.advanceTimersByTimeAsync(81);
    const job = await running;
    expect(job.status).toBe("interrupted");
    expect(signal.aborted).toBe(true);
    expect(job.counters.toolCalls).toBe(1);
    finish();
    await Promise.resolve();
    expect(await f.repository.listMilestones("job-1")).toEqual([]);
  });

  it("bounds a hung planner too, without reserving or executing a tool", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.service.create(input);
    const running = f.service.advance(
      "job-1",
      async () => new Promise(() => {}),
      { maxDurationMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(81);
    const job = await running;
    expect(job.status).toBe("queued");
    expect(job.counters.toolCalls).toBe(0);
  });

  it("rejects non-JSON summaries without completing a milestone", async () => {
    const f = setup();
    await f.service.create(input);
    const invalid = { invalid: undefined } as unknown as null;
    const job = await f.service.advance("job-1", async () => ({
      tool: "inspect",
      inputHash: "h",
      execute: async () => ({ summary: invalid }),
    }));
    expect(job.status).toBe("failed");
    expect(await f.repository.listMilestones("job-1")).toEqual([]);
    expect(
      InvestigationMilestoneSchema.safeParse({
        investigationId: "x",
        attempt: 1,
        seq: 0,
        tool: "x",
        inputHash: "h",
        summary: NaN,
        createdAt: f.now().toISOString(),
      }).success,
    ).toBe(false);
  });
});
