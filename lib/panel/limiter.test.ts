import { describe, expect, it } from "vitest";
import { createAdaptiveLimiter } from "./limiter";

describe("adaptive limiter", () => {
  it("never holds more permits than the cap and queues the rest FIFO", async () => {
    const limiter = createAdaptiveLimiter({ max: 3 });
    const order: number[] = [];
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const permit = await limiter.acquire();
        order.push(i);
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        permit.release("ok");
      }),
    );
    expect(peak).toBe(3);
    expect(limiter.state().peakActive).toBe(3);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rejects a cap below 1", () => {
    expect(() => createAdaptiveLimiter({ max: 0 })).toThrow(RangeError);
  });

  it("halves the cap once for a burst of 429s and pauses all dispatch for retry-after", async () => {
    let clock = 0;
    const slept: number[] = [];
    const limiter = createAdaptiveLimiter({
      max: 8,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    const first = await Promise.all(Array.from({ length: 8 }, () => limiter.acquire()));
    // All eight were dispatched before any decrease, so eight 429s are one event.
    for (const p of first) p.release("rate_limited", 2000);
    expect(limiter.state()).toMatchObject({ cap: 4, decreases: 1, rateLimited: 8, active: 0 });

    const started = clock;
    const next = await limiter.acquire(); // has to wait out the pause
    expect(slept).toEqual([2000]);
    expect(clock - started).toBe(2000);
    // New permits are in the new epoch: a 429 on one of them halves the cap again.
    next.release("rate_limited", 500);
    expect(limiter.state()).toMatchObject({ cap: 2, decreases: 2 });
  });

  it("limits dispatch to the lowered cap while the queue drains", async () => {
    let clock = 0;
    const limiter = createAdaptiveLimiter({
      max: 8,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const held = await Promise.all(Array.from({ length: 8 }, () => limiter.acquire()));
    for (const p of held) p.release("rate_limited", 1);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        const permit = await limiter.acquire();
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        permit.release("error"); // an error neither grows nor shrinks the cap
      }),
    );
    expect(peak).toBe(4);
  });

  it("regrows by about one slot per window of successes, up to the maximum", async () => {
    const limiter = createAdaptiveLimiter({ max: 8, sleep: async () => {} });
    const burst = await Promise.all(Array.from({ length: 8 }, () => limiter.acquire()));
    for (const p of burst) p.release("rate_limited", 0);
    expect(limiter.state().cap).toBe(4);
    for (let i = 0; i < 200; i++) (await limiter.acquire()).release("ok");
    expect(limiter.state().cap).toBe(8);
  });

  it("ignores successes from permits issued before the last decrease", async () => {
    const limiter = createAdaptiveLimiter({ max: 8, sleep: async () => {} });
    const [limited, ...older] = await Promise.all(Array.from({ length: 8 }, () => limiter.acquire()));
    limited!.release("rate_limited", 0);
    expect(limiter.state().cap).toBe(4);
    for (const p of older) p.release("ok"); // dispatched under the old cap
    expect(limiter.state().cap).toBe(4);
  });

  it("release is idempotent", async () => {
    const limiter = createAdaptiveLimiter({ max: 2 });
    const p = await limiter.acquire();
    p.release("ok");
    p.release("rate_limited", 1000);
    expect(limiter.state()).toMatchObject({ active: 0, rateLimited: 0, cap: 2 });
  });

  it("fails queued waiters when the pause wait is aborted instead of hanging", async () => {
    const limiter = createAdaptiveLimiter({
      max: 1,
      sleep: async () => {
        throw new Error("aborted");
      },
    });
    (await limiter.acquire()).release("rate_limited", 1000);
    await expect(limiter.acquire()).rejects.toThrow("aborted");
  });
});
