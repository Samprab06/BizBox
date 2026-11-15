import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createIntakeThreadRecorder } from "./copilot-intake";
import type { ThreadStore } from "./thread-store";

describe("intake phase of project conversation", () => {
  it("appends the validated exchange and draft to the same project thread", async () => {
    const ensure = vi.fn(async () => ({ revision: 3 }));
    const commit = vi.fn<ThreadStore["commit"]>(
      async () => ({}) as Awaited<ReturnType<ThreadStore["commit"]>>,
    );
    const record = createIntakeThreadRecorder({
      ensure,
      commit,
    } as unknown as ThreadStore);
    await record(
      "houston-coffee",
      { message: "I want a cafe", state: {} } as Parameters<typeof record>[1],
      "Tell me about rent",
      { category: "coffee" },
    );
    expect(ensure).toHaveBeenCalledWith("houston-coffee");
    expect(commit).toHaveBeenCalledWith(
      "houston-coffee",
      3,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^intake:/),
        messages: [
          expect.objectContaining({ role: "user", content: "I want a cafe" }),
          expect.objectContaining({
            role: "assistant",
            content: "Tell me about rent",
            metadata: expect.objectContaining({
              validatedDraft: expect.any(Object),
            }),
          }),
        ],
      }),
    );
    expect(commit.mock.calls[0]?.[2].events?.[0]?.type).toBe(
      "intake_completed",
    );
  });

  it("does not append an empty capability or no-op request", async () => {
    const commit = vi.fn();
    const record = createIntakeThreadRecorder({
      commit,
    } as unknown as ThreadStore);
    await record(
      "houston-coffee",
      { state: {} } as Parameters<typeof record>[1],
      "Question",
      {},
    );
    expect(commit).not.toHaveBeenCalled();
  });
});
