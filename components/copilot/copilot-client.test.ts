import { describe, expect, it, vi } from "vitest";
import type { CopilotEvent } from "@/lib/contracts/copilot-runtime";
import { copilotRuntimeFixtures } from "@/fixtures/copilot-runtime";
import {
  COPILOT_UNAVAILABLE_MESSAGE,
  createCopilotClient,
  splitSse,
} from "./copilot-client";
import { copilotContextWithoutRevision, withRevision } from "./copilot-context";

const fixture = copilotRuntimeFixtures[0];
const sse = (frames: unknown[]) =>
  frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");

function streamed(body: string, chunk = 17) {
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk)
          controller.enqueue(bytes.slice(i, i + chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

const request = {
  message: "Try opening at 6am",
  context: fixture.context,
  requestId: "r1",
};

describe("copilot client", () => {
  it("streams validated events across arbitrary chunk boundaries", async () => {
    const fetcher = vi.fn(async () => streamed(sse(fixture.events)));
    const client = createCopilotClient(fetcher as unknown as typeof fetch);
    const events: CopilotEvent[] = [];
    await client.start("p 1", request, (e) => events.push(e));
    expect(events).toEqual(fixture.events);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/projects/p%201/copilot");
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it("skips malformed frames and surfaces the route's failure frame", async () => {
    const client = createCopilotClient((async () =>
      streamed(
        `data: {not json}\n\n${sse([
          { type: "tool_started" },
          fixture.events[0],
          { type: "error", message: "Copilot is temporarily unavailable." },
        ])}`,
      )) as unknown as typeof fetch);
    const events: CopilotEvent[] = [];
    await expect(
      client.start("p", request, (e) => events.push(e)),
    ).rejects.toMatchObject({ status: 503 });
    expect(events).toEqual([fixture.events[0]]);
  });

  it("explains a 503 as the copilot being unavailable", async () => {
    const client = createCopilotClient((async () =>
      Response.json(
        {
          code: "COPILOT_UNAVAILABLE",
          message: "Copilot is temporarily unavailable.",
        },
        { status: 503 },
      )) as unknown as typeof fetch);
    await expect(client.snapshot("p")).rejects.toMatchObject({
      status: 503,
      message: COPILOT_UNAVAILABLE_MESSAGE,
    });
    await expect(client.start("p", request, () => {})).rejects.toMatchObject({
      status: 503,
    });
  });

  it("keeps the server's message for a stale context", async () => {
    const client = createCopilotClient((async () =>
      Response.json(
        {
          code: "STALE_CONTEXT",
          message: "Workspace context changed. Refresh before continuing.",
        },
        { status: 409 },
      )) as unknown as typeof fetch);
    await expect(client.start("p", request, () => {})).rejects.toMatchObject({
      status: 409,
      code: "STALE_CONTEXT",
      message: "Workspace context changed. Refresh before continuing.",
    });
  });

  it("replays the snapshot's persisted events", async () => {
    const client = createCopilotClient((async () =>
      Response.json({
        messages: [],
        events: [
          ...fixture.events.map((payload, seq) => ({ seq, payload })),
          { seq: 99, payload: { type: "nonsense" } },
        ],
      })) as unknown as typeof fetch);
    await expect(client.snapshot("p")).resolves.toEqual(fixture.events);
  });

  it("advances a paused turn with its exact context", async () => {
    const fetcher = vi.fn(async () => streamed(""));
    await createCopilotClient(fetcher as unknown as typeof fetch).advance(
      "p",
      "turn 1",
      fixture.context,
      () => {},
    );
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/projects/p/copilot/turn%201/advance");
    expect(JSON.parse(String(init.body))).toEqual({ context: fixture.context });
  });
});

describe("splitSse", () => {
  it("keeps an unfinished frame for the next chunk", () => {
    expect(splitSse('data: {"a":1}\n\ndata: {"b"')).toEqual({
      data: ['{"a":1}'],
      rest: 'data: {"b"',
    });
  });
});

describe("copilot context", () => {
  it("reads the view, site and active scenario from the page", () => {
    expect(
      copilotContextWithoutRevision({
        projectId: "p",
        pathname: "/projects/p/sites/heights",
        search: "",
        scenarioId: "s1",
      }),
    ).toEqual({
      projectId: "p",
      page: "/projects/p/sites/heights",
      view: "space",
      siteId: "heights",
      scenarioId: "s1",
    });
    expect(
      copilotContextWithoutRevision({
        projectId: "p",
        pathname: "/projects/p/sites/unselected",
        search: `site=${"x".repeat(300)}`,
        scenarioId: null,
      }),
    ).toMatchObject({ view: "space" });
  });

  it("reuses a revision only for an identical selection", () => {
    const base = copilotContextWithoutRevision({
      projectId: "p",
      pathname: "/projects/p/map",
      search: "site=montrose",
      scenarioId: "s1",
    });
    const first = withRevision(base, null, 0);
    expect(first.revision).toBe(1);
    expect(withRevision(base, first, 1).revision).toBe(1);
    expect(withRevision({ ...base, scenarioId: "s2" }, first, 4).revision).toBe(
      5,
    );
  });
});
