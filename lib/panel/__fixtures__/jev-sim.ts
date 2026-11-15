/**
 * Offline simulators for the Jev panel's two I/O boundaries: a fake `fetch` standing in for the
 * System One API (injected latency, optional org rate limit that answers 429 + retry-after,
 * in-flight tracking) and a fake Postgres executor that renders the real drizzle SQL and
 * counts round trips. No network, no key, no paid calls.
 *
 * Latency and rate-limit windows use `setTimeout` and `Date.now`, so a test can run them on
 * Vitest fake timers and measure virtual seconds.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { createRng, hashString } from "@/lib/sim/random";

export interface FakeJevOptions {
  /** Time every accepted request takes. Default 1500 ms. */
  latencyMs?: number;
  /** Per-request latency jitter, +/- ms, from a seeded stream. Default 0. */
  jitterMs?: number;
  /** Token-bucket org limit in requests per second; over it the server answers 429. 0 = none. */
  limitRps?: number;
  /** `retry-after` header (seconds) on 429s. Default 1. */
  retryAfterS?: number;
}

export interface FakeJevServer {
  fetch: typeof fetch;
  readonly requests: number;
  readonly rejected429: number;
  readonly inFlight: number;
  readonly maxInFlight: number;
  /** Arrival order of the responses, by request body hash. */
  readonly completed: string[];
}

interface WireBody {
  questions: Record<string, { type: string; criteria?: Record<string, string> | string[] }>;
}

export function createFakeJev(opts: FakeJevOptions = {}): FakeJevServer {
  const latency = opts.latencyMs ?? 1500;
  const jitter = createRng("fake-jev-jitter");
  const limit = opts.limitRps ?? 0;
  let tokens = limit;
  let lastRefill = Date.now();
  const server = {
    requests: 0,
    rejected429: 0,
    inFlight: 0,
    maxInFlight: 0,
    completed: [] as string[],
  };
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    server.requests++;
    const raw = String(init?.body);
    if (limit > 0) {
      const now = Date.now();
      tokens = Math.min(limit, tokens + ((now - lastRefill) / 1000) * limit);
      lastRefill = now;
      if (tokens < 1) {
        server.rejected429++;
        return new Response("{}", { status: 429, headers: { "retry-after": String(opts.retryAfterS ?? 1) } });
      }
      tokens -= 1;
    }
    server.inFlight++;
    server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
    const wait = latency + (opts.jitterMs ? (jitter.next() * 2 - 1) * opts.jitterMs : 0);
    await new Promise<void>((r) => setTimeout(r, Math.max(0, wait)));
    server.inFlight--;
    server.completed.push(String(hashString(raw)));
    const body = JSON.parse(raw) as WireBody;
    const rng = createRng(hashString(raw)); // the answer is a pure function of the request
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(body.questions)) {
      if (q.type === "noul") answers[name] = { type: "noul", noul: 0.1 + 0.8 * rng.next() };
      else {
        const ids = Array.isArray(q.criteria) ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria ?? {});
        const weights = ids.map(() => 0.2 + rng.next());
        const total = weights.reduce((a, b) => a + b, 0);
        const probabilities = Object.fromEntries(ids.map((id, i) => [id, weights[i]! / total]));
        answers[name] =
          q.type === "score"
            ? { type: "score", score: 2, confidence: 0.6, probabilities }
            : { type: "choice", choice: ids[0], confidence: 0.6, probabilities };
      }
    }
    return new Response(JSON.stringify({ model: "jev-1.14.0", answers, usage: { input_tokens: 600, output_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return Object.assign(server, { fetch: fakeFetch }) as unknown as FakeJevServer;
}

export interface FakePostgres {
  execute(query: SQL): Promise<unknown>;
  /** Round trips by kind. */
  readonly trips: { reads: number; batchReads: number; writes: number; batchWrites: number };
  readonly rows: Map<string, string>;
}

/** Executor for `createPostgresJevCache`: real SQL rendered by drizzle, rows kept in memory. */
export function createFakePostgres(opts: { rttMs?: number } = {}): FakePostgres {
  const dialect = new PgDialect();
  const rows = new Map<string, string>();
  const trips = { reads: 0, batchReads: 0, writes: 0, batchWrites: 0 };
  return {
    trips,
    rows,
    async execute(query) {
      const q = dialect.sqlToQuery(query);
      if (opts.rttMs) await new Promise<void>((r) => setTimeout(r, opts.rttMs));
      if (q.sql.trimStart().startsWith("SELECT")) {
        if (/cache_key IN \(/.test(q.sql)) {
          trips.batchReads++;
          // params: project, model, ...keys
          return q.params.slice(2).flatMap((key) => {
            const v = rows.get(String(key));
            return v ? [{ cache_key: key, response: JSON.parse(v) }] : [];
          });
        }
        trips.reads++;
        const v = rows.get(String(q.params[1]));
        return v ? [{ response: JSON.parse(v) }] : [];
      }
      // INSERT ... VALUES (id,project,key,model,json)[, ...]: five params per row.
      const p = q.params;
      if (p.length > 5) trips.batchWrites++;
      else trips.writes++;
      for (let i = 0; i < p.length; i += 5) rows.set(String(p[i + 2]), String(p[i + 4]));
      return [];
    },
  };
}
