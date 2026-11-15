import { z } from "zod";
import {
  CopilotContextSchema,
  CopilotEventSchema,
  type CopilotContext,
  type CopilotEvent,
  type CopilotTurnRequest,
} from "@/lib/contracts/copilot-runtime";

/**
 * HAC-84: the dock's client for HAC-83's routes. `GET /api/projects/:id/copilot` returns
 * the durable thread (including its persisted events); `POST` starts a turn and
 * `POST .../copilot/:turnId/advance` continues a paused one, both streaming SSE.
 */

export class CopilotHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "CopilotHttpError";
  }
}

export const COPILOT_UNAVAILABLE_MESSAGE =
  "The copilot is unavailable right now. Your workspace still works; try again in a moment.";

const ErrorBodySchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const SnapshotSchema = z.object({
  events: z.array(z.object({ payload: z.unknown() })).default([]),
});

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/copilot`;

async function failure(response: Response): Promise<CopilotHttpError> {
  const body = ErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  const code = body.success ? (body.data.code ?? null) : null;
  // 503 means the runtime (or its database) isn't ready; say so plainly.
  const message =
    response.status === 503 || !body.success
      ? COPILOT_UNAVAILABLE_MESSAGE
      : body.data.message;
  return new CopilotHttpError(message, response.status, code);
}

/** Splits an SSE buffer into complete `data:` payloads and the unfinished rest. */
export function splitSse(buffer: string): { data: string[]; rest: string } {
  const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const data = blocks.flatMap((block) => {
    const lines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    return lines.length ? [lines.join("\n")] : [];
  });
  return { data, rest };
}

/** Validates one SSE payload. The route's own failure frame has no envelope. */
export function parseSseEvent(
  data: string,
): { event: CopilotEvent } | { error: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  const event = CopilotEventSchema.safeParse(value);
  if (event.success) return { event: event.data };
  const error = z
    .object({ type: z.literal("error"), message: z.string() })
    .safeParse(value);
  return error.success ? { error: error.data.message } : null;
}

async function readStream(
  response: Response,
  onEvent: (event: CopilotEvent) => void,
) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const { data, rest } = splitSse(done ? `${buffer}\n\n` : buffer);
    buffer = rest;
    for (const payload of data) {
      const parsed = parseSseEvent(payload);
      if (!parsed) continue;
      if ("error" in parsed) throw new CopilotHttpError(parsed.error, 503);
      onEvent(parsed.event);
    }
    if (done) return;
  }
}

export type CopilotClient = {
  snapshot(projectId: string, signal?: AbortSignal): Promise<CopilotEvent[]>;
  start(
    projectId: string,
    request: CopilotTurnRequest,
    onEvent: (event: CopilotEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  advance(
    projectId: string,
    turnId: string,
    context: CopilotContext,
    onEvent: (event: CopilotEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
};

export function createCopilotClient(
  fetcher: typeof fetch = (...args) => fetch(...args),
): CopilotClient {
  const post = async (
    url: string,
    body: unknown,
    onEvent: (event: CopilotEvent) => void,
    signal?: AbortSignal,
  ) => {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw await failure(response);
    await readStream(response, onEvent);
  };
  return {
    async snapshot(projectId, signal) {
      const response = await fetcher(base(projectId), {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw await failure(response);
      const snapshot = SnapshotSchema.parse(await response.json());
      return snapshot.events.flatMap(({ payload }) => {
        const event = CopilotEventSchema.safeParse(payload);
        return event.success ? [event.data] : [];
      });
    },
    start: (projectId, request, onEvent, signal) =>
      post(base(projectId), request, onEvent, signal),
    advance: (projectId, turnId, context, onEvent, signal) =>
      post(
        `${base(projectId)}/${encodeURIComponent(turnId)}/advance`,
        { context: CopilotContextSchema.parse(context) },
        onEvent,
        signal,
      ),
  };
}
