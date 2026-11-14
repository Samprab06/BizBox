import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CacheWriter, MemoryJevCache, readCache, type JevCache } from "./cache";
import type { JevAskResult } from "./jev-client";

const result: JevAskResult = { modelVersion: "m", answers: { x: { probabilities: { yes: 1, no: 0 }, confidence: 1 } } };

describe("CacheWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes a multi-row batch every batchSize answers", async () => {
    const cache = new MemoryJevCache();
    const writer = new CacheWriter(cache, { batchSize: 16 });
    for (let i = 0; i < 40; i++) writer.add(`k${i}`, result);
    await writer.flush();
    expect(cache.size).toBe(40);
    expect(cache.sets).toBe(3); // 16 + 16 + 8
    expect(writer.writes).toBe(3);
  });

  it("flushes a lone answer after the interval", async () => {
    const cache = new MemoryJevCache();
    const writer = new CacheWriter(cache, { batchSize: 16, intervalMs: 1000 });
    writer.add("k", result);
    expect(cache.size).toBe(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(cache.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(cache.size).toBe(1);
  });

  it("flush() writes what is buffered and waits for writes in flight", async () => {
    const written: string[][] = [];
    const slow: JevCache = {
      get: async () => undefined,
      set: async () => {},
      setMany: async (entries) => {
        await new Promise((r) => setTimeout(r, 50));
        written.push(entries.map((e) => e.key));
      },
    };
    const writer = new CacheWriter(slow, { batchSize: 2 });
    writer.add("a", result);
    writer.add("b", result); // drains
    writer.add("c", result);
    const flushed = writer.flush();
    await vi.advanceTimersByTimeAsync(200);
    await flushed;
    expect(written).toEqual([["a", "b"], ["c"]]);
  });

  it("falls back to one set per answer without setMany, and counts failures instead of throwing", async () => {
    const sets: string[] = [];
    const plain: JevCache = {
      get: async () => undefined,
      set: async (key) => {
        if (key === "bad") throw new Error("db down");
        sets.push(key);
      },
    };
    const writer = new CacheWriter(plain, { batchSize: 2 });
    writer.add("a", result);
    writer.add("bad", result);
    writer.add("c", result);
    await writer.flush();
    expect(sets).toEqual(["a", "c"]); // the failing batch stops at "bad"; the next batch still writes
    expect(writer.failures).toBe(1);
  });
});

describe("readCache", () => {
  it("uses getMany when present (one call) and get per key otherwise", async () => {
    const cache = new MemoryJevCache();
    await cache.set("a", result);
    const before = cache.gets;
    expect([...(await readCache(cache, ["a", "b"])).keys()]).toEqual(["a"]);
    expect(cache.gets - before).toBe(1);

    const plain: JevCache = { get: async (k) => (k === "a" ? result : undefined), set: async () => {} };
    expect([...(await readCache(plain, ["a", "b"])).keys()]).toEqual(["a"]);
  });
});
