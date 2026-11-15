import { describe, expect, it, vi } from "vitest";

// The copilot routes follow the HAC-58 runtime-loader pattern: importing them,
// request validation and the "not configured" path never load the agent SDKs.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/copilot-model", () => {
  throw new Error("Cannot find module '@langchain/core/dist/index.cjs'");
});
vi.mock("@/lib/agent/runner", () => {
  throw new Error("Cannot find module '@langchain/core/dist/index.cjs'");
});
import * as streamRoute from "./route";
import * as advanceRoute from "./[turnId]/advance/route";
import { lazyCopilotDecisionModel } from "@/lib/agent/copilot";

const context = {
  params: Promise.resolve({ projectId: "houston-coffee", turnId: "t-1" }),
};

describe("copilot routes without a loadable agent SDK", () => {
  it("import and validate requests", async () => {
    const response = await streamRoute.POST(
      new Request("http://localhost/api/projects/houston-coffee/copilot", {
        method: "POST",
        body: JSON.stringify({ bogus: 1 }),
      }),
      context,
    );
    expect(response.status).toBe(422);
    const advance = await advanceRoute.POST(
      new Request("http://localhost/x", { method: "POST", body: "{" }),
      context,
    );
    expect(advance.status).toBe(422);
  });

  it("reports not configured without loading the SDK, and a typed error when it cannot load", async () => {
    const input = {
      mode: "default",
      context: {},
      history: [],
      completedToolCalls: [],
      tools: [],
      signal: new AbortController().signal,
    };
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      await expect(lazyCopilotDecisionModel(input)).rejects.toThrow(
        "Intake model is not configured",
      );
      vi.stubEnv("OPENAI_API_KEY", "test-key-not-used");
      await expect(lazyCopilotDecisionModel(input)).rejects.toThrow(
        "Model runtime unavailable",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
