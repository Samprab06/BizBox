/**
 * Jev REST client for TypeSafe's System One API.
 *
 * API: POST https://api.typesafe.ai/v1/systemone with `Authorization: Bearer <key>`.
 * Sources: https://docs.typesafe.ai/api/system-one.md and https://api.typesafe.ai/openapi.json
 * (HAC-54). Everything that depends on the wire format lives in the "Wire format" section
 * (`toWireRequest`, `WireResponseSchema`, `fromWireResponse`, `JEV_PATH`). The rest of the
 * panel only sees `JevAskRequest` and `JevAskResult`.
 */
import { z } from "zod";

/** Model requested from System One. `GET /v1/models` lists `jev-latest` and `jev-preview`. */
export const JEV_MODEL_VERSION = "jev-latest";
export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai";

// ---------------------------------------------------------------------------
// Panel-facing types (stable)
// ---------------------------------------------------------------------------

export interface JevState {
  person: string;
  need: string;
  options: Record<string, string>;
}

export type JevQuestion =
  | { name: string; type: "choice"; prompt: string; options: { id: string; label: string }[] }
  | { name: string; type: "score"; prompt: string; levels: { id: string; label: string }[] }
  | { name: string; type: "noul"; prompt: string };

export interface JevAskRequest {
  state: JevState;
  questions: JevQuestion[];
}

/**
 * One answer, normalised. Choice and Score: a probability for every option id. Noul:
 * `{ yes: p, no: 1 - p }`. Probabilities are stored, never only the pick.
 */
export interface JevAnswer {
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevAskResult {
  modelVersion: string;
  answers: Record<string, JevAnswer>;
}

export interface JevClient {
  readonly modelVersion: string;
  ask(request: JevAskRequest): Promise<JevAskResult>;
}

// ---------------------------------------------------------------------------
// Wire format: TypeSafe System One
// ---------------------------------------------------------------------------
//
// POST {baseUrl}/v1/systemone
// Authorization: Bearer <JEV_API_KEY>
// {
//   "model": "jev-latest",
//   "state": { ...JevState },
//   "questions": {
//     "where":     { "type": "choice", "instructions": "...", "criteria": { "site_a": "site_a", "none": "None of these" } },
//     "how_often": { "type": "score",  "instructions": "...", "criteria": ["Never", "About once a month", ...] },
//     "stay_at_queue_4": { "type": "noul", "instructions": "..." }
//   }
// }
// 200 ->
// {
//   "model": "jev-1.14.0",
//   "answers": {
//     "where":     { "type": "choice", "choice": "site_a", "confidence": 0.82, "probabilities": { "site_a": 0.6, ... } },
//     "how_often": { "type": "score", "score": 2.1, "confidence": 0.7, "legend": { "0": "...", ... }, "probabilities": { "0": 0.05, ... } },
//     "stay_at_queue_4": { "type": "noul", "noul": 0.64 }
//   },
//   "usage": { "input_tokens": 640, "output_tokens": 0 }
// }
//
// Choice criteria keep the panel's (shuffled) option order: JSON object key order is preserved.
// Score levels are the criteria array; answers key them by index ("0", "1", ...), mapped back to
// level ids here. Noul answers carry no confidence; |2p - 1| stands in for it (0 at p = 0.5).

export const JEV_PATH = "/v1/systemone";

export function toWireRequest(modelVersion: string, req: JevAskRequest): unknown {
  const questions: Record<string, unknown> = {};
  for (const q of req.questions) {
    if (q.type === "choice")
      questions[q.name] = {
        type: "choice",
        instructions: q.prompt,
        criteria: Object.fromEntries(q.options.map((o) => [o.id, o.label])),
      };
    else if (q.type === "score")
      questions[q.name] = { type: "score", instructions: q.prompt, criteria: q.levels.map((l) => l.label) };
    else questions[q.name] = { type: "noul", instructions: q.prompt };
  }
  return { model: modelVersion, state: req.state, questions };
}

const ProbabilityMap = z.record(z.string(), z.number().min(0).max(1));
const WireAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: ProbabilityMap,
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    legend: z.record(z.string(), z.unknown()).optional(),
    probabilities: ProbabilityMap,
  }),
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
]);
export const WireResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), WireAnswerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});
export type WireResponse = z.infer<typeof WireResponseSchema>;

export function fromWireResponse(raw: unknown, req: JevAskRequest): JevAskResult {
  const parsed = WireResponseSchema.parse(raw);
  const answers: Record<string, JevAnswer> = {};
  for (const q of req.questions) {
    const a = parsed.answers[q.name];
    if (!a) throw new JevError(`Jev response is missing question "${q.name}"`, false);
    if (a.type !== q.type) throw new JevError(`Jev answered "${q.name}" as ${a.type}, expected ${q.type}`, false);
    if (a.type === "noul") {
      answers[q.name] = { probabilities: { yes: a.noul, no: 1 - a.noul }, confidence: Math.abs(2 * a.noul - 1) };
    } else if (a.type === "score" && q.type === "score") {
      answers[q.name] = {
        probabilities: Object.fromEntries(q.levels.map((l, i) => [l.id, a.probabilities[String(i)] ?? 0])),
        confidence: a.confidence,
      };
    } else if (a.type === "choice") {
      answers[q.name] = { probabilities: a.probabilities, confidence: a.confidence };
    }
  }
  return { modelVersion: parsed.model, answers };
}

// ---------------------------------------------------------------------------
// HTTP client: concurrency limit, timeout, retry with exponential backoff
// ---------------------------------------------------------------------------

export class JevError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevHttpClientOptions {
  baseUrl: string;
  apiKey: string;
  modelVersion?: string;
  /** Max requests in flight. Default 8. */
  concurrency?: number;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Backoff base; attempt n waits base * 2^n (or Retry-After). Default 500 ms. */
  baseDelayMs?: number;
  /** Per-attempt timeout. Default 20 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createJevClient(opts: JevHttpClientOptions): JevClient {
  const modelVersion = opts.modelVersion ?? JEV_MODEL_VERSION;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const limit = createLimiter(opts.concurrency ?? 8);
  const url = opts.baseUrl.replace(/\/+$/, "") + JEV_PATH;

  async function attempt(req: JevAskRequest): Promise<{ ok: true; value: JevAskResult } | { ok: false; error: JevError; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(toWireRequest(modelVersion, req)),
        signal: controller.signal,
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const retryAfter = Number(res.headers.get("retry-after"));
        return {
          ok: false,
          error: new JevError(`Jev HTTP ${res.status}`, retryable, res.status),
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        };
      }
      const body: unknown = await res.json();
      try {
        return { ok: true, value: fromWireResponse(body, req) };
      } catch (e) {
        if (e instanceof JevError) return { ok: false, error: e };
        return { ok: false, error: new JevError(`Malformed Jev response: ${(e as Error).message}`, false) };
      }
    } catch (e) {
      // Network failure or timeout.
      return { ok: false, error: new JevError(`Jev request failed: ${(e as Error).message}`, true) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    modelVersion,
    ask(req) {
      return limit(async () => {
        let last: JevError | undefined;
        for (let n = 0; n <= maxRetries; n++) {
          const r = await attempt(req);
          if (r.ok) return r.value;
          last = r.error;
          if (!r.error.retryable || n === maxRetries) break;
          await sleep(r.retryAfterMs ?? baseDelayMs * 2 ** n);
        }
        throw last ?? new JevError("Jev request failed", false);
      });
    },
  };
}

/** Client from environment: JEV_API_KEY (required), JEV_BASE_URL and JEV_MODEL (optional). */
export function createJevClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<JevHttpClientOptions> = {},
): JevClient {
  const apiKey = env.JEV_API_KEY?.trim();
  if (!apiKey) throw new Error("JEV_API_KEY is not set");
  const baseUrl = env.JEV_BASE_URL?.trim() || DEFAULT_JEV_BASE_URL;
  const modelVersion = env.JEV_MODEL?.trim() || undefined;
  return createJevClient({ baseUrl, apiKey, ...(modelVersion ? { modelVersion } : {}), ...overrides });
}

/** Simple FIFO concurrency limiter. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!(max >= 1)) throw new RangeError("concurrency must be >= 1");
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
}
