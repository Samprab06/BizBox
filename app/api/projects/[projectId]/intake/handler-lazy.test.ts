import { describe, expect, it, vi } from "vitest";

// HAC-58: the agent SDK must not be needed for validation, and a load failure must be a typed 503.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/runner", () => {
  throw new Error("Cannot find module '@langchain/core/dist/index.cjs'");
});
vi.mock("@/lib/agent/runtime-loader", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agent/runtime-loader")>();
  return {
    ...actual,
    loadIntakeRunner: async () => {
      throw new actual.ModelRuntimeUnavailableError(
        "Error: Cannot find module '@langchain/core/dist/index.cjs'",
      );
    },
  };
});
import { createIntakeHandler } from "./handler";

const context = { params: Promise.resolve({ projectId: "houston-coffee" }) };
const post = (body: unknown) =>
  new Request("http://localhost/api/projects/houston-coffee/intake", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("intake without a loadable agent SDK", () => {
  it("still validates requests", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(post({ bogus: 1 }), context);
    expect(response.status).toBe(422);
  });

  it("reports a typed 503 with a safe detail when a chat message needs the model", async () => {
    const handler = createIntakeHandler({ projectExists: async () => true });
    const response = await handler(
      post({ message: "I want to open a coffee shop" }),
      context,
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("MODEL_RUNTIME_UNAVAILABLE");
    expect(body.detail).toMatch(/Cannot find module/);
  });
});

describe("intake provider failure diagnostics", () => {
  it("reports only the error class, HTTP status and provider code", async () => {
    const failure = Object.assign(
      new Error("Incorrect API key provided: sk-PRIVATE123456"),
      {
        name: "AuthenticationError",
        status: 401,
        code: "invalid_api_key",
      },
    );
    const handler = createIntakeHandler({
      projectExists: async () => true,
      runAgent: async () => {
        throw failure;
      },
    });
    const response = await handler(post({ message: "Coffee" }), context);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).detail).toBe(
      "AuthenticationError HTTP 401 invalid_api_key",
    );
    expect(text).not.toContain("PRIVATE");
  });
});
