import { describe, expect, it } from "vitest";
import {
  createJevClient,
  createJevClientFromEnv,
  createLimiter,
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_CONCURRENCY,
  fromWireResponse,
  JevError,
  jevBundleOrdersFromEnv,
  JEV_MODEL_VERSION,
  parseJevConcurrency,
} from "./jev-client";
import { buildPersonas } from "./personas";
import { buildQuestions, buildState, type PanelContext } from "./state";
import { catchment, coffeeNeed, recorded, recordedFetch } from "./__fixtures__";

const ctx: PanelContext = { site: catchment.site, competitors: catchment.competitors, need: coffeeNeed };
const persona = buildPersonas(catchment).personas[0]!;
const request = { state: buildState(persona, ctx), questions: buildQuestions(ctx).questions };

function client(fetchStub: typeof fetch, delays: number[] = [], extra: { maxRetries?: number; maxRateLimitRetries?: number } = {}) {
  return createJevClient({
    baseUrl: "https://jev.test/",
    apiKey: "test-key",
    fetch: fetchStub,
    sleep: async (ms) => {
      delays.push(ms);
    },
    baseDelayMs: 100,
    ...extra,
  });
}

describe("Jev client against recorded responses (offline)", () => {
  it("sends a System One request and normalises the recorded answer", async () => {
    const rec = recordedFetch();
    const result = await client(rec.fetch).ask(request);

    expect(rec.requests).toHaveLength(1);
    const sent = rec.requests[0]!;
    expect(sent.url).toBe("https://jev.test/v1/systemone");
    expect(sent.headers.authorization).toBe("Bearer test-key");
    expect(sent.body.model).toBe(JEV_MODEL_VERSION);
    expect(Object.values(sent.body.questions).map((q) => q.type)).toEqual([
      "choice",
      "score",
      "choice",
      "noul",
      "noul",
      "noul",
      "noul",
      "noul",
      "noul",
    ]);
    // Choice criteria keep the panel's option order; score criteria are the level labels in order.
    const where = request.questions.find((q) => q.name === "where");
    if (where?.type === "choice") expect(Object.keys(sent.body.questions.where!.criteria!)).toEqual(where.options.map((o) => o.id));
    expect(Array.isArray(sent.body.questions.how_often!.criteria)).toBe(true);

    expect(result.modelVersion).toBe("jev-1.14.0");
    expect(Object.keys(result.answers.where!.probabilities).sort()).toEqual(["comp_1", "comp_2", "none", "site_a"]);
    expect(result.answers.stay_at_queue_0!.probabilities.yes).toBeGreaterThan(0.9);
    expect(result.answers.stay_at_queue_0!.probabilities.no).toBeCloseTo(1 - result.answers.stay_at_queue_0!.probabilities.yes!);
    expect(result.answers.how_often!.confidence).toBeGreaterThan(0);
  });

  it("maps score levels by index and gives noul answers a |2p - 1| confidence", () => {
    const variant = recorded.variants[0]!;
    const result = fromWireResponse(variant, request);
    expect(result.answers.how_often!.probabilities).toEqual({
      never: 0.06,
      monthly: 0.18,
      weekly: 0.41,
      several_a_week: 0.27,
      daily: 0.08,
    });
    const p = variant.answers.stay_at_queue_4.noul;
    expect(result.answers.stay_at_queue_4!.confidence).toBeCloseTo(Math.abs(2 * p - 1));
  });

  it("rejects answers that are missing or of the wrong type", () => {
    const variant = structuredClone(recorded.variants[0]!) as { answers: Record<string, unknown> };
    delete variant.answers.when;
    expect(() => fromWireResponse(variant, request)).toThrow(/missing question "when"/);
    const wrong = structuredClone(recorded.variants[0]!) as { answers: Record<string, unknown> };
    wrong.answers.where = { type: "noul", noul: 0.5 };
    expect(() => fromWireResponse(wrong, request)).toThrow(/expected choice/);
  });

  it("retries 503 and 429 with exponential backoff and Retry-After", async () => {
    const rec = recordedFetch({ statuses: [503, 429, 503] });
    const delays: number[] = [];
    const result = await client(rec.fetch, delays).ask(request);
    expect(result.answers.where).toBeDefined();
    expect(rec.requests).toHaveLength(4);
    // 100*2^0 for the 503; the 429 waits out the limiter's Retry-After pause (1 s, to the ms
    // the clock allows); then 100*2^1, because a 429 does not use up a transport retry.
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBeGreaterThan(900);
    expect(delays[1]).toBeLessThanOrEqual(1000);
    expect(delays[2]).toBe(200);
  });

  it("gives up after maxRetries", async () => {
    const rec = recordedFetch({ statuses: [503, 503, 503] });
    await expect(client(rec.fetch, [], { maxRetries: 2 }).ask(request)).rejects.toBeInstanceOf(JevError);
    expect(rec.requests).toHaveLength(3);
  });

  it("does not retry client errors", async () => {
    const rec = recordedFetch({ statuses: [400] });
    await expect(client(rec.fetch).ask(request)).rejects.toMatchObject({ status: 400, retryable: false });
    expect(rec.requests).toHaveLength(1);
  });

  it("rejects malformed responses without retrying", async () => {
    const rec = recordedFetch({ body: recorded.malformed });
    await expect(client(rec.fetch).ask(request)).rejects.toThrow(/Malformed|missing/);
    expect(rec.requests).toHaveLength(1);
  });

  it("retries network errors", async () => {
    let n = 0;
    const rec = recordedFetch();
    const flaky = (async (...args: Parameters<typeof fetch>) => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return rec.fetch(...args);
    }) as typeof fetch;
    await expect(client(flaky).ask(request)).resolves.toBeDefined();
    expect(n).toBe(2);
  });

  it("limits requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const rec = recordedFetch();
    const slow = (async (...args: Parameters<typeof fetch>) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return rec.fetch(...args);
    }) as typeof fetch;
    const c = createJevClient({ baseUrl: "https://jev.test", apiKey: "k", fetch: slow, concurrency: 3 });
    await Promise.all(Array.from({ length: 12 }, () => c.ask(request)));
    expect(peak).toBe(3);
  });

  it("a 429 pauses dispatch for every queued request, not just the one that was limited", async () => {
    let clock = 0;
    const arrivals: number[] = [];
    const rec = recordedFetch();
    let n = 0;
    const server = (async (...args: Parameters<typeof fetch>) => {
      arrivals.push(clock);
      if (n++ === 0) return new Response("{}", { status: 429, headers: { "retry-after": "2" } });
      return rec.fetch(...args);
    }) as typeof fetch;
    const c = createJevClient({
      baseUrl: "https://jev.test",
      apiKey: "k",
      fetch: server,
      concurrency: 1,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    // Three requests share one slot: the first is limited, the other two were already queued.
    await Promise.all([c.ask(request), c.ask(request), c.ask(request)]);
    expect(arrivals).toHaveLength(4); // one 429 and three answers
    expect(arrivals[0]).toBe(0);
    expect(arrivals.slice(1).every((t) => t >= 1900)).toBe(true); // nobody went ahead of the pause
    expect(c.limiter?.()).toMatchObject({ rateLimited: 1, active: 0, queued: 0 });
  });

  it("gives up on a request that is rate limited past its 429 budget", async () => {
    const rec = recordedFetch({ statuses: [429, 429, 429] });
    await expect(
      client(rec.fetch, [], { maxRateLimitRetries: 1 }).ask(request),
    ).rejects.toMatchObject({ status: 429, retryable: true });
    expect(rec.requests).toHaveLength(2);
  });

  it("reads JEV_CONCURRENCY, falling back to 32 and clamping to 1..256", () => {
    expect(parseJevConcurrency(undefined)).toBe(DEFAULT_JEV_CONCURRENCY);
    expect(parseJevConcurrency("")).toBe(32);
    expect(parseJevConcurrency("abc")).toBe(32);
    expect(parseJevConcurrency("0")).toBe(32);
    expect(parseJevConcurrency("1.5")).toBe(32);
    expect(parseJevConcurrency("16")).toBe(16);
    expect(parseJevConcurrency(" 64 ")).toBe(64);
    expect(parseJevConcurrency("100000")).toBe(256);
    const c = createJevClientFromEnv({ JEV_API_KEY: "k", JEV_CONCURRENCY: "5" }, { fetch: recordedFetch().fetch });
    expect(c.limiter?.().cap).toBe(5);
    expect(createJevClientFromEnv({ JEV_API_KEY: "k" }).limiter?.().cap).toBe(32);
  });

  it("reads JEV_BUNDLE_ORDERS as an opt-in flag, off by default", () => {
    expect(jevBundleOrdersFromEnv({})).toBe(false);
    expect(jevBundleOrdersFromEnv({ JEV_BUNDLE_ORDERS: "0" })).toBe(false);
    expect(jevBundleOrdersFromEnv({ JEV_BUNDLE_ORDERS: "1" })).toBe(true);
    expect(jevBundleOrdersFromEnv({ JEV_BUNDLE_ORDERS: " TRUE " })).toBe(true);
  });

  it("limiter keeps FIFO order and propagates errors", async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        limit(async () => {
          order.push(i);
          if (i === 2) throw new Error("boom");
          return i;
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("needs JEV_API_KEY; JEV_BASE_URL defaults to TypeSafe's API and JEV_MODEL is optional", async () => {
    expect(() => createJevClientFromEnv({})).toThrow(/JEV_API_KEY/);
    const rec = recordedFetch();
    const c = createJevClientFromEnv({ JEV_API_KEY: "k", JEV_MODEL: "jev-preview" }, { fetch: rec.fetch });
    expect(c.modelVersion).toBe("jev-preview");
    await c.ask(request);
    expect(rec.requests[0]!.url).toBe(`${DEFAULT_JEV_BASE_URL}/v1/systemone`);
    expect(rec.requests[0]!.body.model).toBe("jev-preview");
  });
});

// Live test: only runs with a real key. Never runs in CI by default.
describe.skipIf(!process.env.JEV_API_KEY)("Jev live [live]", () => {
  it("answers one persona x site call", async () => {
    const live = createJevClientFromEnv(process.env, { maxRetries: 1 });
    const result = await live.ask(request);
    expect(result.modelVersion).toMatch(/^jev-/);
    for (const q of request.questions) expect(result.answers[q.name]).toBeDefined();
  }, 60_000);
});
