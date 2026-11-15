/**
 * Jev answer cache. Keyed by a SHA-256 of model version + state + questions (the exact
 * request body), so any change to the persona, site, option order or question text is a
 * miss and an unchanged input is a hit. Values are normalised probabilities, not picks.
 *
 * The production implementation is the Postgres `jev_cache` table (see README.md for the
 * proposed Drizzle definition, to be added to lib/db/schema.ts once HAC-9 lands).
 */
import type { JevAskRequest, JevAskResult } from "./jev-client";

export interface JevCache {
  get(key: string): Promise<JevAskResult | undefined>;
  set(key: string, value: JevAskResult): Promise<void>;
  /** Optional batch read: one round trip for many keys. Missing keys are absent from the map. */
  getMany?(keys: string[]): Promise<Map<string, JevAskResult>>;
  /** Optional batch write: one round trip for many answers. */
  setMany?(entries: { key: string; value: JevAskResult }[]): Promise<void>;
}

export class MemoryJevCache implements JevCache {
  private readonly store = new Map<string, JevAskResult>();
  gets = 0;
  sets = 0;

  async get(key: string): Promise<JevAskResult | undefined> {
    this.gets++;
    const v = this.store.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async set(key: string, value: JevAskResult): Promise<void> {
    this.sets++;
    this.store.set(key, structuredClone(value));
  }

  async getMany(keys: string[]): Promise<Map<string, JevAskResult>> {
    this.gets++;
    const out = new Map<string, JevAskResult>();
    for (const key of keys) {
      const v = this.store.get(key);
      if (v !== undefined) out.set(key, structuredClone(v));
    }
    return out;
  }

  async setMany(entries: { key: string; value: JevAskResult }[]): Promise<void> {
    this.sets++;
    for (const { key, value } of entries) this.store.set(key, structuredClone(value));
  }

  get size(): number {
    return this.store.size;
  }
}

/** The canonical string that is hashed into the cache key. */
export function cacheKeyMaterial(modelVersion: string, req: JevAskRequest): string {
  return JSON.stringify({ model: modelVersion, state: req.state, questions: req.questions });
}

/** Hex SHA-256 cache key. Uses Web Crypto, available in Node 18+, Vercel functions and edge. */
export async function jevCacheKey(modelVersion: string, req: JevAskRequest): Promise<string> {
  const bytes = new TextEncoder().encode(cacheKeyMaterial(modelVersion, req));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CacheWriterOptions {
  /** Flush once this many answers are buffered. Default 16. */
  batchSize?: number;
  /** Flush buffered answers at most this long after the first one arrived. Default 1000 ms. */
  intervalMs?: number;
}

/**
 * Buffers answers and writes them with `setMany` (one multi-row upsert), flushing every
 * `batchSize` answers or `intervalMs`, whichever comes first, and on `flush()`. Without
 * `setMany` it falls back to one `set` per answer. A write that fails is counted, not thrown:
 * the answer is already in hand, and the cache is only a checkpoint.
 */
export class CacheWriter {
  private buffer: { key: string; value: JevAskResult }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> = Promise.resolve();
  private readonly batchSize: number;
  private readonly intervalMs: number;
  /** Batches written (round trips when `setMany` exists). */
  writes = 0;
  failures = 0;

  constructor(
    private readonly cache: JevCache,
    opts: CacheWriterOptions = {},
  ) {
    this.batchSize = Math.max(1, Math.floor(opts.batchSize ?? 16));
    this.intervalMs = Math.max(0, opts.intervalMs ?? 1000);
  }

  add(key: string, value: JevAskResult): void {
    this.buffer.push({ key, value });
    if (this.buffer.length >= this.batchSize) this.drain();
    else if (!this.timer) {
      this.timer = setTimeout(() => this.drain(), this.intervalMs);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Writes everything buffered and waits for all writes so far. */
  async flush(): Promise<void> {
    this.drain();
    await this.inflight;
  }

  private drain(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.inflight = this.inflight.then(async () => {
      this.writes++;
      try {
        if (this.cache.setMany) await this.cache.setMany(batch);
        else for (const e of batch) await this.cache.set(e.key, e.value);
      } catch {
        this.failures++;
      }
    });
  }
}

/** Reads `keys` in one `getMany` when the cache has it, else one `get` per key. */
export async function readCache(cache: JevCache, keys: string[]): Promise<Map<string, JevAskResult>> {
  if (cache.getMany) return cache.getMany(keys);
  const out = new Map<string, JevAskResult>();
  await Promise.all(
    keys.map(async (key) => {
      const hit = await cache.get(key);
      if (hit) out.set(key, hit);
    }),
  );
  return out;
}
