import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryInvestigationRepository } from "@/lib/agent/jobs-memory";
import type { InvestigationRepository } from "@/lib/agent/jobs";

const state = vi.hoisted(() => ({
  repository: undefined as unknown as InvestigationRepository,
  toolsCreated: 0,
  executed: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/jobs-postgres", () => ({
  createPostgresInvestigationRepository: () => state.repository,
}));
vi.mock("@/lib/agent/tools-postgres", async () => {
  const { InvestigationToolSchemas } = await import("@/lib/agent/tools");
  return {
    createPostgresInvestigationTools: () => {
      state.toolsCreated++;
      return {
        definitions: [
          {
            name: "search_sites",
            description: "Synthetic fixture search",
            schema: InvestigationToolSchemas.search_sites,
          },
        ],
        execute: async () => {
          state.executed++;
          return {
            summary: { siteIds: ["201:301"] },
            findings: ["Synthetic source finding"],
          };
        },
      };
    },
  };
});
vi.mock("@/lib/agent/investigation-planner", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/agent/investigation-planner")
  >("@/lib/agent/investigation-planner");
  return {
    ...actual,
    createConfiguredInvestigationPlanner: (
      tools: Parameters<typeof actual.createInvestigationPlanner>[0]["tools"],
    ) =>
      actual.createInvestigationPlanner({
        tools,
        choose: async ({ milestones }) =>
          milestones.length
            ? {
                tool: "finish",
                argsJson: "{}",
                findings: ["Synthetic handoff ready"],
                done: true,
              }
            : {
                tool: "search_sites",
                argsJson: "{}",
                findings: [],
                done: false,
              },
      }),
  };
});

const request = (body: unknown) =>
  new Request("http://test/api/investigations", {
    method: "POST",
    body: JSON.stringify(body),
  });
const input = {
  projectId: "p1",
  profileId: "profile1",
  question: "Compare synthetic sites",
};
beforeEach(() => {
  vi.resetModules();
  state.repository = createMemoryInvestigationRepository();
  state.toolsCreated = 0;
  state.executed = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production investigation runtime wiring", () => {
  it("constructs no provider/tool dependencies while unconfigured and preserves queued work", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { investigationHandlers: handlers } = await import("./runtime");
    const { job } = await (await handlers.create(request(input))).json();
    expect(state.toolsCreated).toBe(0);
    const response = await handlers.advance(request({}), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(response.status).toBe(503);
    expect((await state.repository.load(job.id))?.status).toBe("queued");
    expect(state.executed).toBe(0);
  });

  it("lazily advances the configured scripted planner and retains its durable summaries on reload", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-configured-test-key");
    const { investigationHandlers: handlers } = await import("./runtime");
    const { job } = await (await handlers.create(request(input))).json();
    expect(state.toolsCreated).toBe(0);
    const context = { params: Promise.resolve({ id: job.id }) };
    const response = await handlers.advance(request({}), context);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.job.status).toBe("succeeded");
    expect(result.job.findings).toContain("Synthetic handoff ready");
    expect(result.milestones.map((m: { tool: string }) => m.tool)).toEqual([
      "search_sites",
      "finish_investigation",
    ]);
    expect(state.executed).toBe(1);
    expect(state.toolsCreated).toBeGreaterThan(0);
    const read = await handlers.get(new Request("http://test"), context);
    expect((await read.json()).milestones).toEqual(result.milestones);
    expect(state.executed).toBe(1);
  });
});
