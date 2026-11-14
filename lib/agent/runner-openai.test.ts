import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntakeSession } from "./intake";
import { modelConfiguration, runConfiguredIntakeAgent } from "./runner";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configured OpenAI intake", () => {
  it("uses an optional OpenAI-compatible base URL without changing the default", () => {
    expect(modelConfiguration({})).toEqual({ timeout: 10_000, maxRetries: 0 });
    expect(modelConfiguration({ OPENAI_BASE_URL: " https://opencode.ai/inference/openai/v1 " })).toEqual({
      timeout: 10_000,
      maxRetries: 0,
      baseURL: "https://opencode.ai/inference/openai/v1",
    });
  });

  it("sends a tool-calling turn to the configured compatible endpoint", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://opencode.ai/inference/openai/v1");
    vi.stubEnv("OPENAI_MODEL", "glm-5.3-flash-free");
    const requests: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({
        id: "chatcmpl-compatible-test", object: "chat.completion", created: 1,
        model: "glm-5.3-flash-free",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Which city?" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }));
    await runConfiguredIntakeAgent({
      session: createIntakeSession("p1"),
      message: "I want a coffee shop",
      signal: new AbortController().signal,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
    expect((await requests[0]!.json()).model).toBe("glm-5.3-flash-free");
  });

  it("requires a private key before any model request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      runConfiguredIntakeAgent({
        session: createIntakeSession("p1"),
        message: "Coffee",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Intake model is not configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, "gpt-5.4"])(
    "executes save_profile through the real SDK/graph with model override %s",
    async (override) => {
      vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
      vi.stubEnv("OPENAI_MODEL", override ?? " ");
      const requests: Record<string, unknown>[] = [];
      const fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          requests.push(await request.json());
          return Response.json({
            id: `chatcmpl-test-${requests.length}`,
            object: "chat.completion",
            created: 1,
            model: override ?? "gpt-6-luna",
            choices: [
              {
                index: 0,
                finish_reason: requests.length === 1 ? "tool_calls" : "stop",
                message:
                  requests.length === 1
                    ? {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            id: "save-test",
                            type: "function",
                            function: {
                              name: "save_profile",
                              arguments: JSON.stringify({
                                category: "coffee",
                                concept: "Neighborhood coffee",
                              }),
                            },
                          },
                        ],
                      }
                    : { role: "assistant", content: "Which city?" },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        },
      );
      vi.stubGlobal("fetch", fetch);
      const session = createIntakeSession("p1");
      const message = await runConfiguredIntakeAgent({
        session,
        message: "I want a coffee shop",
        signal: new AbortController().signal,
      });
      expect(session.snapshot().draft.concept).toBe("Neighborhood coffee");
      expect(message).toBe("Which city?");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        model: override ?? "gpt-6-luna",
        temperature: 0,
        max_completion_tokens: 1500,
        reasoning_effort: "none",
      });
      expect(
        (requests[0].tools as { function: { name: string } }[]).map(
          (entry) => entry.function.name,
        ),
      ).toEqual(["save_profile"]);
    },
  );

  it("does not retry or select a fallback after a provider failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { message: "Unavailable", type: "server_error" } },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      runConfiguredIntakeAgent({
        session: createIntakeSession("p1"),
        message: "Coffee",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
