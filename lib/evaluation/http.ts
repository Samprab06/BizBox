import { z } from "zod";

/** Evaluation requests carry cached behavior tables, so allow larger bodies than other routes. */
export const MAX_EVALUATION_BODY_BYTES = 4 * 1024 * 1024;

export const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export class BodyError extends Error {}

export async function readJsonBody(request: Request, limit = MAX_EVALUATION_BODY_BYTES): Promise<unknown> {
  if (!request.body) throw new BodyError("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyError("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BodyError("Invalid JSON");
  }
}

export function invalid(code: string, message: string, error: unknown) {
  const field_errors: Record<string, string[]> = {};
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) (field_errors[issue.path.join(".") || "_request"] ??= []).push(issue.message);
  } else field_errors._request = [error instanceof Error ? error.message : "Invalid request"];
  return json({ code, message, field_errors }, 422);
}

export const unavailable = (code: string, message: string) => json({ code, message, field_errors: {} }, 503);
export const notFound = (code: string, message: string) => json({ code, message, field_errors: {} }, 404);
