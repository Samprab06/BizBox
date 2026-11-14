import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvestigationService,
  type InvestigationStepPlanner,
  type InvestigationMilestone,
} from "./jobs";
import { createMemoryInvestigationRepository } from "./jobs-memory";

afterEach(() => vi.useRealTimers());
describe("trusted idempotent tool deadline recovery", () => {
  it("resumes the same attempt and unfinished key while preserving completed milestones and charged capacity", async () => {
    vi.useFakeTimers();
    const repository = createMemoryInvestigationRepository();
    const service = createInvestigationService(repository, {
      id: () => "resume",
      resumeToolTimeouts: true,
    });
    await service.create({
      projectId: "p",
      profileId: "profile",
      question: "Compare",
    });
    const keys: string[] = [];
    let tries = 0;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const planner: InvestigationStepPlanner = async ({ nextSeq }) => ({
      tool: nextSeq === 0 ? "search_sites" : "evaluate_sites",
      inputHash: `input-${nextSeq}`,
      execute: async ({
        signal,
        idempotencyKey,
      }): Promise<{
        summary: InvestigationMilestone["summary"];
        findings?: string[];
        done?: boolean;
      }> => {
        keys.push(idempotencyKey);
        if (nextSeq === 0)
          return { summary: { ids: ["1:2"] }, findings: ["Search complete"] };
        if (++tries === 1) {
          started();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          return { summary: { late: true } };
        }
        return {
          summary: { comparisonId: "same-durable-artifact" },
          done: true,
        };
      },
    });
    const first = service.advance("resume", planner, { maxDurationMs: 100 });
    await ready;
    await vi.advanceTimersByTimeAsync(81);
    expect(await first).toMatchObject({
      status: "running",
      attempt: 1,
      counters: { toolCalls: 2, evaluateSites: 1 },
    });
    expect(await repository.listMilestones("resume")).toHaveLength(1);
    const final = await service.advance("resume", planner, {
      maxDurationMs: 100,
    });
    expect(final).toMatchObject({
      status: "succeeded",
      attempt: 1,
      counters: { toolCalls: 3, evaluateSites: 2 },
    });
    expect(keys).toEqual([
      "resume:1:0:input-0",
      "resume:1:1:input-1",
      "resume:1:1:input-1",
    ]);
    expect(
      (await repository.listMilestones("resume")).map((m) => m.summary),
    ).toEqual([{ ids: ["1:2"] }, { comparisonId: "same-durable-artifact" }]);
  });

  it("keeps trusted planner cutoffs running without spending tool capacity", async () => {
    vi.useFakeTimers();
    const service = createInvestigationService(
      createMemoryInvestigationRepository(),
      { id: () => "planner", resumeToolTimeouts: true },
    );
    await service.create({
      projectId: "p",
      profileId: "profile",
      question: "Compare",
    });
    const advancing = service.advance(
      "planner",
      async () => new Promise(() => {}),
      { maxDurationMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(81);
    expect(await advancing).toMatchObject({
      status: "running",
      counters: { toolCalls: 0 },
    });
  });
});
