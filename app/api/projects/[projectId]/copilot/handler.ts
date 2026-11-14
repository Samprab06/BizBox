import { z } from "zod";
import {
  CopilotAdvanceRequestSchema,
  CopilotTurnRequestSchema,
} from "@/lib/contracts/copilot-runtime";

const id = z.string().trim().min(1).max(200);
const MAX_BODY_BYTES = 64 * 1024;
type Context = { params: Promise<{ projectId: string; turnId?: string }> };

export type CopilotHttpRuntime = {
  snapshot(projectId: string): Promise<unknown>;
  start(
    projectId: string,
    input: unknown,
    signal: AbortSignal,
  ): AsyncIterable<unknown>;
  advance(
    projectId: string,
    turnId: string,
    input: unknown,
    signal: AbortSignal,
  ): AsyncIterable<unknown>;
};

const json = (value: unknown, status: number) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function body(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function stream(
  iterator: AsyncIterator<unknown>,
  first: IteratorResult<unknown>,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder();
  const response = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done && !signal.aborted)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(first.value)}\n\n`),
          );
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          if (signal.aborted) break;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`),
          );
        }
      } catch {
        // Do not leak provider or SQL error details to the client.
        if (!signal.aborted)
          controller.enqueue(
            encoder.encode(
              'data: {"type":"error","message":"Copilot is temporarily unavailable."}\n\n',
            ),
          );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(response, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function failure(error: unknown) {
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    (error instanceof Error &&
      /Missing body|Body too large/.test(error.message))
  )
    return json(
      {
        code: "INVALID_COPILOT_REQUEST",
        message: "Provide a valid copilot turn.",
      },
      422,
    );
  const message = error instanceof Error ? error.message : "";
  if (/stale|context changed|mismatch|current turn|proposal/i.test(message))
    return json(
      {
        code: "STALE_CONTEXT",
        message: "Workspace context changed. Refresh before continuing.",
      },
      409,
    );
  if (/not found|no resumable/i.test(message))
    return json(
      { code: "NOT_FOUND", message: "Copilot turn or project not found." },
      404,
    );
  return json(
    {
      code: "COPILOT_UNAVAILABLE",
      message: "Copilot is temporarily unavailable.",
    },
    503,
  );
}

export function createCopilotHandlers(runtime: CopilotHttpRuntime) {
  return {
    async GET(_request: Request, context: Context) {
      try {
        return json(
          await runtime.snapshot(id.parse((await context.params).projectId)),
          200,
        );
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request, context: Context) {
      try {
        const projectId = id.parse((await context.params).projectId);
        const input = CopilotTurnRequestSchema.parse(await body(request));
        const iterator = runtime
          .start(projectId, input, request.signal)
          [Symbol.asyncIterator]();
        return stream(iterator, await iterator.next(), request.signal);
      } catch (error) {
        return failure(error);
      }
    },
    async advance(request: Request, context: Context) {
      try {
        const { projectId, turnId } = await context.params;
        const input = CopilotAdvanceRequestSchema.parse(await body(request));
        const iterator = runtime
          .advance(id.parse(projectId), id.parse(turnId), input, request.signal)
          [Symbol.asyncIterator]();
        return stream(iterator, await iterator.next(), request.signal);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
