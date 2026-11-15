/**
 * Adaptive global concurrency limiter for Jev requests (HAC-131).
 *
 * One limiter is shared by every request a client makes, so it is the single place that knows
 * how hard the TypeSafe organisation limit is being pushed. It runs AIMD:
 *   - a rate-limited response (429) halves the cap and pauses *all* dispatch for `retry-after`,
 *     so the rest of the queue does not keep hammering a limit that was just hit;
 *   - each success adds 1 to the cap, up to the maximum (the ticket's "+1 per success").
 * A burst of 429s that were all dispatched before the first decrease counts as one event: they
 * extend the pause but do not halve the cap again (`epoch`).
 *
 * Permits are per attempt, not per ask: a request waiting out a back-off holds no slot.
 */

export type PermitOutcome = "ok" | "rate_limited" | "error";

export interface Permit {
  /** Idempotent. `retryAfterMs` applies to `rate_limited`. */
  release(outcome: PermitOutcome, retryAfterMs?: number): void;
}

export interface AdaptiveLimiterOptions {
  /** Ceiling for in-flight requests (the configured cap). */
  max: number;
  /** Floor the cap never drops below. Default 1. */
  min?: number;
  now?: () => number;
  /** Used to wait out a pause. Rejecting it fails every queued waiter. */
  sleep?: (ms: number) => Promise<void>;
}

export interface AdaptiveLimiterState {
  cap: number;
  active: number;
  queued: number;
  /** Highest number of permits held at once. */
  peakActive: number;
  /** Rate-limited releases seen. */
  rateLimited: number;
  /** Times the cap was actually halved. */
  decreases: number;
}

export interface AdaptiveLimiter {
  acquire(): Promise<Permit>;
  state(): AdaptiveLimiterState;
}

interface Waiter {
  resolve(p: Permit): void;
  reject(e: unknown): void;
}

export function createAdaptiveLimiter(opts: AdaptiveLimiterOptions): AdaptiveLimiter {
  const max = Math.floor(opts.max);
  if (!(max >= 1)) throw new RangeError("concurrency must be >= 1");
  const min = Math.min(max, Math.max(1, Math.floor(opts.min ?? 1)));
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let cap = max; // fractional while growing
  let active = 0;
  let peakActive = 0;
  let epoch = 0;
  let pausedUntil = 0;
  let pumpScheduled = false;
  let rateLimited = 0;
  let decreases = 0;
  const queue: Waiter[] = [];

  const slots = () => Math.max(min, Math.floor(cap));

  function grant(w: Waiter) {
    active++;
    peakActive = Math.max(peakActive, active);
    const myEpoch = epoch;
    let released = false;
    w.resolve({
      release(outcome, retryAfterMs) {
        if (released) return;
        released = true;
        active--;
        if (outcome === "ok") {
          // Successes from before the last decrease say nothing about the new, lower cap.
          if (myEpoch === epoch) cap = Math.min(max, cap + 1);
        } else if (outcome === "rate_limited") {
          rateLimited++;
          if (myEpoch === epoch) {
            cap = Math.max(min, Math.floor(cap / 2));
            epoch++;
            decreases++;
          }
          pausedUntil = Math.max(pausedUntil, now() + Math.max(0, retryAfterMs ?? 0));
        }
        pump();
      },
    });
  }

  function pump() {
    if (queue.length === 0) return;
    if (pausedUntil > now()) {
      schedule();
      return;
    }
    while (queue.length > 0 && active < slots()) grant(queue.shift()!);
  }

  function schedule() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    const target = pausedUntil;
    sleep(Math.max(0, target - now())).then(
      () => {
        pumpScheduled = false;
        // The pause has been served; only a later extension keeps it alive.
        if (pausedUntil === target) pausedUntil = 0;
        pump();
      },
      (e: unknown) => {
        pumpScheduled = false;
        for (const w of queue.splice(0)) w.reject(e);
      },
    );
  }

  return {
    acquire() {
      return new Promise<Permit>((resolve, reject) => {
        queue.push({ resolve, reject });
        pump();
      });
    },
    state: () => ({ cap: Math.floor(cap), active, queued: queue.length, peakActive, rateLimited, decreases }),
  };
}
