import { describe, expect, it, vi } from "vitest";
import { createCopilotHandlers } from "./handler";

const context = (projectId = "houston-coffee", turnId = "turn-1") => ({
  params: Promise.resolve({ projectId, turnId }),
});
const selection = {
  projectId: "houston-coffee",
  page: "/projects/houston-coffee/workspace",
  view: "city",
  revision: 0,
};
const readEvents = async (response: Response) => {
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  return (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
};

describe("copilot transport", () => {
  it("returns the same durable snapshot on reload without caching it", async () => {
    const snapshot = vi
      .fn()
      .mockResolvedValue({ threadId: "thread-1", todos: ["check rent"] });
    const handlers = createCopilotHandlers({
      snapshot,
      start: vi.fn(),
      advance: vi.fn(),
    });
    const response = await handlers.GET(
      new Request("https://example.test"),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      threadId: "thread-1",
      todos: ["check rent"],
    });
    expect(snapshot).toHaveBeenCalledWith("houston-coffee");
  });

  it("streams typed events and resumes the scoped turn", async () => {
    const start = vi.fn(async function* () {
      yield { type: "todo", text: "Check candidate" };
      yield { type: "message", text: "Two sites found" };
    });
    const advance = vi.fn(async function* () {
      yield { type: "done" };
    });
    const handlers = createCopilotHandlers({
      snapshot: vi.fn(),
      start,
      advance,
    });
    const response = await handlers.POST(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({
          message: "Find coffee sites",
          requestId: "request-1",
          context: selection,
        }),
      }),
      context(),
    );
    expect(await readEvents(response)).toEqual([
      { type: "todo", text: "Check candidate" },
      { type: "message", text: "Two sites found" },
    ]);
    expect(start).toHaveBeenCalledWith(
      "houston-coffee",
      {
        message: "Find coffee sites",
        requestId: "request-1",
        context: selection,
      },
      expect.any(AbortSignal),
    );
    expect(
      await readEvents(
        await handlers.advance(
          new Request("https://example.test", {
            method: "POST",
            body: JSON.stringify({ context: selection }),
          }),
          context(),
        ),
      ),
    ).toEqual([{ type: "done" }]);
    expect(advance).toHaveBeenCalledWith(
      "houston-coffee",
      "turn-1",
      { context: selection },
      expect.any(AbortSignal),
    );
  });

  it("rejects oversized and malformed requests before invoking runtime", async () => {
    const start = vi.fn();
    const handlers = createCopilotHandlers({
      snapshot: vi.fn(),
      start,
      advance: vi.fn(),
    });
    const response = await handlers.POST(
      new Request("https://example.test", {
        method: "POST",
        body: "x".repeat(65 * 1024),
      }),
      context(),
    );
    expect(response.status).toBe(422);
    expect(start).not.toHaveBeenCalled();
  });
});
