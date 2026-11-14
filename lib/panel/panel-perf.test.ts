/**
 * HAC-131: speed and robustness of the Jev panel against a simulated API. The real code path
 * (`runPanelForSites` -> `createJevClient` with its adaptive limiter -> `createPostgresJevCache`
 * with the real drizzle SQL) runs against a fake `fetch` with 1.5 s of latency per call and a
 * fake Postgres executor, on Vitest fake timers, so the times below are virtual seconds. No
 * network, no key, no paid calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BehaviorTable } from "./contracts";
import { MemoryJevCache, type JevCache } from "./cache";
import { createPostgresJevCache } from "./cache-postgres";
import { createJevClient } from "./jev-client";
import { runPanelForSites } from "./panel";
import { buildPersonas } from "./personas";
import { catchment, coffeeNeed, makeSites } from "./__fixtures__";
import { createFakeJev, createFakePostgres, type FakeJevOptions } from "./__fixtures__/jev-sim";

const personaSet = buildPersonas(catchment, { count: 50 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Steps virtual time until `p` settles. Returns its value and the virtual seconds it took. */
async function drive<T>(p: Promise<T>): Promise<{ value: T; seconds: number }> {
  const t0 = Date.now();
  let done = false;
  const settled = p.finally(() => {
    done = true;
  });
  settled.catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(25);
  return { value: await settled, seconds: (Date.now() - t0) / 1000 };
}

interface Scenario {
  sites: number;
  cap: number;
  bundle?: boolean;
  server?: FakeJevOptions;
  cache?: () => JevCache;
  orders?: number;
}

async function run(s: Scenario, pre?: { cache: JevCache }) {
  const server = createFakeJev(s.server);
  const client = createJevClient({ baseUrl: "https://jev.test", apiKey: "fake", fetch: server.fetch, concurrency: s.cap });
  const cache = pre?.cache ?? s.cache?.() ?? new MemoryJevCache();
  const result = await drive(
    runPanelForSites({
      personaSet,
      sites: makeSites(s.sites),
      competitors: catchment.competitors,
      need: coffeeNeed,
      client,
      cache,
      bundleOrders: s.bundle ?? false,
      ...(s.orders ? { orders: s.orders } : {}),
    }),
  );
  const failed = result.value.tables.reduce((a, t) => a + t.failedPersonaIds.length, 0);
  return { server, client, cache, seconds: result.seconds, ...result.value, failed };
}

const report = (label: string, r: { seconds: number; stats: { calls: number }; server: { maxInFlight: number; rejected429: number } }) =>
  console.info(
    `[HAC-131] ${label}: ${r.seconds.toFixed(1)} s virtual, ${r.stats.calls} calls, max in flight ${r.server.maxInFlight}, 429s ${r.server.rejected429}`,
  );

describe("speed at 1.5 s per Jev call (virtual time)", () => {
  it("bundled orders at cap 32: 8 sites in under 30 s, 1 site in under 6 s", async () => {
    const eight = await run({ sites: 8, cap: 32, bundle: true });
    report("8 sites, bundled, cap 32", eight);
    expect(eight.stats.calls).toBe(400);
    expect(eight.failed).toBe(0);
    expect(eight.seconds).toBeLessThan(30);

    const one = await run({ sites: 1, cap: 32, bundle: true });
    report("1 site, bundled, cap 32", one);
    expect(one.stats.calls).toBe(50);
    expect(one.failed).toBe(0);
    expect(one.seconds).toBeLessThan(6);
  });

  it("unbundled (the default) is bounded by calls / cap: 1,600 calls at cap 32", async () => {
    const eight = await run({ sites: 8, cap: 32 });
    report("8 sites, unbundled, cap 32", eight);
    expect(eight.stats.calls).toBe(1600);
    expect(eight.failed).toBe(0);
    // ceil(1600 / 32) x 1.5 s = 75 s: about 4x faster than the old cap of 8 (300 s).
    expect(eight.seconds).toBeLessThan(80);
    expect(eight.seconds).toBeGreaterThan(70);

    const one = await run({ sites: 1, cap: 32 });
    report("1 site, unbundled, cap 32", one);
    expect(one.stats.calls).toBe(200);
    expect(one.seconds).toBeLessThan(12);
  });

  it("the old cap of 8 takes 300 s for 8 sites (the baseline this ticket started from)", async () => {
    const eight = await run({ sites: 8, cap: 8 });
    report("8 sites, unbundled, cap 8", eight);
    expect(eight.seconds).toBeGreaterThan(295);
    const one = await run({ sites: 1, cap: 8 });
    report("1 site, unbundled, cap 8", one);
    expect(one.seconds).toBeGreaterThan(37);
  }, 60_000);
});

describe("in-flight requests never exceed the configured cap", () => {
  it.each([1, 8, 32])("cap %i", async (cap) => {
    const r = await run({ sites: 1, cap, server: { latencyMs: 100 }, orders: 2 });
    expect(r.server.maxInFlight).toBe(cap); // saturated, and never above
    expect(r.client.limiter?.().peakActive).toBe(cap);
    expect(r.failed).toBe(0);
  });

  it("holds under a rate-limited server too", async () => {
    const r = await run({ sites: 8, cap: 32, bundle: true, server: { limitRps: 20 } });
    expect(r.server.maxInFlight).toBeLessThanOrEqual(32);
    expect(r.client.limiter?.().peakActive).toBeLessThanOrEqual(32);
  });
});

describe("a simulated 20 req/s org limit (429 + retry-after: 1)", () => {
  it("bundled: 8 sites finish with zero failed personas in under 40 s", async () => {
    const r = await run({ sites: 8, cap: 32, bundle: true, server: { limitRps: 20, retryAfterS: 1 } });
    report("8 sites, bundled, cap 32, 20 req/s limit", r);
    expect(r.failed).toBe(0);
    expect(r.tables.every((t) => t.personas.length === 50)).toBe(true);
    expect(r.seconds).toBeLessThan(40);
    expect(r.client.limiter?.().decreases).toBeGreaterThan(0); // it did back off
  });

  it("unbundled: raising the cap no longer sends sites to Huff (zero failed personas)", async () => {
    const r = await run({ sites: 8, cap: 32, server: { limitRps: 20, retryAfterS: 1 } });
    report("8 sites, unbundled, cap 32, 20 req/s limit", r);
    expect(r.failed).toBe(0);
    // 1,600 calls at 20 req/s is an 80 s floor.
    expect(r.seconds).toBeGreaterThan(80);
  }, 60_000);

  it("a cap far above the limit still finishes without failed personas", async () => {
    const r = await run({ sites: 8, cap: 128, bundle: true, server: { limitRps: 20, retryAfterS: 1 } });
    report("8 sites, bundled, cap 128, 20 req/s limit", r);
    expect(r.failed).toBe(0);
  });
});

describe("cache round trips", () => {
  it.each([false, true])("a warm rerun makes zero Jev calls and one cache read (bundled=%s)", async (bundle) => {
    const pg = createFakePostgres();
    const cache = createPostgresJevCache(pg, "project-a", "jev-latest");
    const cold = await run({ sites: 4, cap: 32, bundle, server: { latencyMs: 50 } }, { cache });
    expect(cold.failed).toBe(0);
    expect(cold.stats.calls).toBe(bundle ? 200 : 800);
    // Cold: one batched read up front; writes are multi-row batches, not one per answer.
    expect(pg.trips.batchReads).toBe(1);
    expect(pg.trips.reads).toBe(0);
    expect(pg.trips.writes + pg.trips.batchWrites).toBeLessThanOrEqual(Math.ceil(cold.stats.calls / 16) + 2);
    expect(pg.rows.size).toBe(cold.stats.calls);

    const readsBefore = pg.trips.batchReads + pg.trips.reads;
    const warm = await run({ sites: 4, cap: 32, bundle, server: { latencyMs: 50 } }, { cache });
    expect(warm.server.requests).toBe(0);
    expect(warm.stats.calls).toBe(0);
    expect(warm.stats.cacheHits).toBe(cold.stats.calls);
    expect(pg.trips.batchReads + pg.trips.reads - readsBefore).toBeLessThanOrEqual(2);
    expect(JSON.stringify(warm.tables)).toBe(JSON.stringify(cold.tables));
  });

  it("a 20 ms database round trip does not throttle Jev calls (batched I/O)", async () => {
    const pg = createFakePostgres({ rttMs: 20 });
    const cache = createPostgresJevCache(pg, "project-a", "jev-latest");
    const r = await run({ sites: 8, cap: 32, bundle: true }, { cache });
    // 13 waves of 1.5 s, plus a handful of 20 ms trips that overlap with the waves.
    expect(r.seconds).toBeLessThan(30);
    expect(r.failed).toBe(0);
  });
});

describe("determinism: same seed and inputs, byte-identical tables", () => {
  const tablesOf = (tables: BehaviorTable[]) => JSON.stringify(tables);

  it.each([false, true])("cap 1 vs cap 32, and any response arrival order (bundled=%s)", async (bundle) => {
    const small = { sites: 2, bundle, orders: 4 };
    const serial = await run({ ...small, cap: 1, server: { latencyMs: 5 } });
    const wide = await run({ ...small, cap: 32, server: { latencyMs: 5 } });
    // Responses arrive in a different order: random latency per call.
    const shuffled = await run({ ...small, cap: 32, server: { latencyMs: 400, jitterMs: 390 } });
    const reversed = await run({ ...small, cap: 7, server: { latencyMs: 400, jitterMs: 390 } });

    expect(serial.stats.calls).toBe(bundle ? 100 : 400);
    expect(tablesOf(wide.tables)).toBe(tablesOf(serial.tables));
    expect(tablesOf(shuffled.tables)).toBe(tablesOf(serial.tables));
    expect(tablesOf(reversed.tables)).toBe(tablesOf(serial.tables));
    // ...and the arrival orders really did differ.
    expect(shuffled.server.completed.join()).not.toBe(wide.server.completed.join());
    expect(reversed.server.completed.join()).not.toBe(shuffled.server.completed.join());
  }, 60_000);

  it("rate limiting and retries do not change the tables either", async () => {
    const clean = await run({ sites: 2, cap: 32, bundle: true, server: { latencyMs: 100 } });
    const limited = await run({ sites: 2, cap: 32, bundle: true, server: { latencyMs: 100, limitRps: 10 } });
    expect(limited.server.rejected429).toBeGreaterThan(0);
    expect(tablesOf(limited.tables)).toBe(tablesOf(clean.tables));
  });
});
