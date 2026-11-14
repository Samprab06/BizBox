import { describe, expect, it, vi } from "vitest";
import { createMemoryInvestigationRepository } from "@/lib/agent/jobs-memory";
import { type InvestigationStepPlanner } from "@/lib/agent/jobs";
import { createInvestigationHandlers } from "./handlers";

const request = (input: unknown) =>
  new Request("http://localhost/api/investigations", {
    method: "POST",
    body: JSON.stringify(input),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const input = {
  projectId: "p1",
  profileId: "profile1",
  question: "Compare two sites",
};
const planner: InvestigationStepPlanner = async ({ nextSeq }) =>
  nextSeq
    ? null
    : {
        tool: "inspect",
        inputHash: "hash0",
        execute: async () => ({
          summary: { result: "synthetic" },
          findings: ["Synthetic finding"],
          done: true,
        }),
      };

describe("investigation API", () => {
  it("creates, advances and reads durable summaries through the same repository", async () => {
    const repository = createMemoryInvestigationRepository();
    const handlers = createInvestigationHandlers({ repository, planner });
    const created = await handlers.create(request(input));
    expect(created.status).toBe(201);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    const { job } = await created.json();
    const advanced = await handlers.advance(request({}), context(job.id));
    expect((await advanced.json()).job).toMatchObject({
      status: "succeeded",
      counters: { toolCalls: 1 },
    });
    const loaded = await handlers.get(
      new Request("http://localhost"),
      context(job.id),
    );
    expect((await loaded.json()).milestones).toMatchObject([
      { seq: 0, summary: { result: "synthetic" } },
    ]);
  });
  it.each([
    { ...input, attempt: 4 },
    { ...input, counters: {} },
    { ...input, limits: { toolCalls: 26 } },
    {},
  ])("rejects caller-owned state and invalid limits: %j", async (value) => {
    const handlers = createInvestigationHandlers({
      repository: createMemoryInvestigationRepository(),
    });
    expect((await handlers.create(request(value))).status).toBe(422);
  });
  it("returns 404 for missing jobs and 503 without a real executor, without fake progress", async () => {
    const repository = createMemoryInvestigationRepository();
    const handlers = createInvestigationHandlers({ repository });
    expect(
      (await handlers.get(new Request("http://localhost"), context("missing")))
        .status,
    ).toBe(404);
    expect(
      (await handlers.advance(request({}), context("missing"))).status,
    ).toBe(404);
    const { job } = await (await handlers.create(request(input))).json();
    const result = await handlers.advance(request({}), context(job.id));
    expect(result.status).toBe(503);
    expect((await repository.load(job.id))?.status).toBe("queued");
    expect(await repository.listMilestones(job.id)).toEqual([]);
  });
  it("retries failed jobs without accepting replacement counters or limits", async () => {
    const handlers = createInvestigationHandlers({
      repository: createMemoryInvestigationRepository(),
      planner,
    });
    const { job } = await (
      await handlers.create(request({ ...input, limits: { toolCalls: 0 } }))
    ).json();
    expect(
      (await (await handlers.advance(request({}), context(job.id))).json()).job
        .status,
    ).toBe("failed");
    const retry = await handlers.advance(
      request({ action: "retry" }),
      context(job.id),
    );
    expect((await retry.json()).job).toMatchObject({
      attempt: 2,
      status: "queued",
      counters: { toolCalls: 0 },
    });
    expect(
      (
        await handlers.advance(
          request({ action: "retry", counters: { toolCalls: 0 } }),
          context(job.id),
        )
      ).status,
    ).toBe(422);
  });
  it("sanitizes database failures and bounds JSON bodies", async () => {
    const repository = createMemoryInvestigationRepository();
    vi.spyOn(repository, "create").mockRejectedValue(
      new Error("PRIVATE_CONNECTION_CREDENTIAL"),
    );
    const handlers = createInvestigationHandlers({ repository });
    const failure = await handlers.create(request(input));
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("PRIVATE_CONNECTION_CREDENTIAL");
    for (const value of [
      "{broken",
      JSON.stringify({ question: "x".repeat(70_000) }),
    ]) {
      expect(
        (
          await handlers.create(
            new Request("http://localhost", { method: "POST", body: value }),
          )
        ).status,
      ).toBe(422);
    }
  });
});
