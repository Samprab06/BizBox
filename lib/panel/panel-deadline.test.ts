/**
 * HAC-155: a deadline-aware Jev panel. A live panel for several sites can take longer than a
 * Vercel function may run (60 s), so `runPanelForSites` takes a deadline, stops issuing calls
 * near it, keeps every answer already received (cached by key) and reports the run as in
 * progress; the next run with the same inputs resumes from the cache.
 *
 * The real client (`createJevClient` with its adaptive limiter) runs against a fake `fetch` with
 * 1.5 s of latency per call, on Vitest fake timers, so every time below is virtual. No network,
 * no key, no paid calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryJevCache, type JevCache } from "./cache";
import { createJevClient, type JevClient } from "./jev-client";
import { runPanelForSites } from "./panel";
import { buildPersonas } from "./personas";
import { catchment, coffeeNeed, makeSites } from "./__fixtures__";
import { createFakeJev } from "./__fixtures__/jev-sim";

const personaSet = buildPersonas(catchment, { count: 50 });
const sites = makeSites(8);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Steps virtual time until `p` settles. Returns its value and the virtual ms it took. */
async function drive<T>(p: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  let done = false;
  const settled = p.finally(() => {
    done = true;
  });
  settled.catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(25);
  return { value: await settled, ms: Date.now() - t0 };
}

function panel(
  client: JevClient,
  cache: JevCache,
  extra: Record<string, unknown> = {},
) {
  return runPanelForSites({
    personaSet,
    sites,
    competitors: catchment.competitors,
    need: coffeeNeed,
    client,
    cache,
    seed: 7,
    ...extra,
  });
}

describe("deadline-limited panel (1.5 s per fake Jev call)", () => {
  it("8 sites never exceed the deadline, and resuming matches an unbounded run", async () => {
    const server = createFakeJev({ latencyMs: 1500 });
    const client = createJevClient({
      baseUrl: "https://jev.test",
      apiKey: "fake",
      fetch: server.fetch,
      concurrency: 32,
    });
    const cache = new MemoryJevCache();
    const budgetMs = 20_000;

    // 1,600 calls at cap 32 need about 75 s; with a 20 s budget the panel takes several runs.
    const runs: {
      ms: number;
      completed: number;
      total: number;
      inProgress: boolean;
    }[] = [];
    let last: Awaited<ReturnType<typeof panel>> | undefined;
    for (let i = 0; i < 20; i++) {
      const deadlineAt = Date.now() + budgetMs;
      const { value, ms } = await drive(panel(client, cache, { deadlineAt }));
      expect(Date.now()).toBeLessThanOrEqual(deadlineAt);
      runs.push({
        ms,
        completed: value.progress.completedPersonas,
        total: value.progress.totalPersonas,
        inProgress: value.progress.inProgress,
      });
      last = value;
      if (!value.progress.inProgress) break;
      // A partial run never presents unfinished personas as failed or finished.
      for (const t of value.tables) expect(t.failedPersonaIds).toEqual([]);
    }
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.every((r) => r.ms <= budgetMs)).toBe(true);
    expect(runs[0]!.inProgress).toBe(true);
    expect(runs[0]!.completed).toBeLessThan(runs[0]!.total);
    expect(runs[0]!.total).toBe(50 * 8);
    // Progress only grows, and the last run is complete.
    for (let i = 1; i < runs.length; i++)
      expect(runs[i]!.completed).toBeGreaterThanOrEqual(runs[i - 1]!.completed);
    expect(runs.at(-1)!.inProgress).toBe(false);
    // No answer was asked twice across the resumed runs.
    expect(server.requests).toBe(50 * 8 * 4);

    // Same seeds, fresh cache, no deadline: identical tables.
    const reference = createFakeJev({ latencyMs: 1500 });
    const unbounded = await drive(
      panel(
        createJevClient({
          baseUrl: "https://jev.test",
          apiKey: "fake",
          fetch: reference.fetch,
          concurrency: 32,
        }),
        new MemoryJevCache(),
      ),
    );
    expect(unbounded.value.progress.inProgress).toBe(false);
    expect(last!.tables).toEqual(unbounded.value.tables);

    // An unchanged rerun with a deadline is served entirely from the cache.
    const before = server.requests;
    const rerun = await drive(
      panel(client, cache, { deadlineAt: Date.now() + budgetMs }),
    );
    expect(server.requests).toBe(before);
    expect(rerun.value.progress.inProgress).toBe(false);
    expect(rerun.value.tables).toEqual(unbounded.value.tables);
  }, 30_000);

  it("a call slower than expected is abandoned at the reserve, not waited for", async () => {
    let asked = 0;
    const client: JevClient = {
      modelVersion: "jev-test",
      ask: () => {
        asked++;
        return new Promise(() => {}); // never answers
      },
    };
    const deadlineAt = Date.now() + 10_000;
    const { value } = await drive(
      runPanelForSites({
        personaSet,
        sites: sites.slice(0, 1),
        competitors: catchment.competitors,
        need: coffeeNeed,
        client,
        cache: new MemoryJevCache(),
        deadlineAt,
        deadlineReserveMs: 1_000,
        estimatedCallMs: 1_500,
      }),
    );
    expect(Date.now()).toBeLessThanOrEqual(deadlineAt - 1_000);
    expect(asked).toBeGreaterThan(0);
    expect(value.progress).toEqual({
      completedPersonas: 0,
      totalPersonas: 50,
      inProgress: true,
    });
    expect(value.tables[0]!.personas).toEqual([]);
    expect(value.tables[0]!.failedPersonaIds).toEqual([]);
  });

  it("an aborted signal issues no calls and reports progress from the cache", async () => {
    const server = createFakeJev({ latencyMs: 1500 });
    const client = createJevClient({
      baseUrl: "https://jev.test",
      apiKey: "fake",
      fetch: server.fetch,
      concurrency: 32,
    });
    const { value } = await drive(
      panel(client, new MemoryJevCache(), { signal: AbortSignal.abort() }),
    );
    expect(server.requests).toBe(0);
    expect(value.progress).toEqual({
      completedPersonas: 0,
      totalPersonas: 400,
      inProgress: true,
    });
  });

  it("keeps calls that exhausted their retries as failed personas, not pending ones", async () => {
    const client: JevClient = {
      modelVersion: "jev-test",
      ask: async () => {
        throw new Error("boom");
      },
    };
    const { value } = await drive(
      runPanelForSites({
        personaSet,
        sites: sites.slice(0, 1),
        competitors: catchment.competitors,
        need: coffeeNeed,
        client,
        cache: new MemoryJevCache(),
        deadlineAt: Date.now() + 30_000,
      }),
    );
    expect(value.progress).toEqual({
      completedPersonas: 50,
      totalPersonas: 50,
      inProgress: false,
    });
    expect(value.tables[0]!.failedPersonaIds).toHaveLength(50);
  });

  it("without a deadline the run is never in progress", async () => {
    const server = createFakeJev({ latencyMs: 1500 });
    const client = createJevClient({
      baseUrl: "https://jev.test",
      apiKey: "fake",
      fetch: server.fetch,
      concurrency: 32,
    });
    const { value } = await drive(
      panel(client, new MemoryJevCache(), { orders: 1 }),
    );
    expect(value.progress.inProgress).toBe(false);
    expect(value.progress.completedPersonas).toBe(400);
  });
});
