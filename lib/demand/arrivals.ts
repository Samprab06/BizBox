/**
 * Time of day and seeded arrivals.
 *
 * Cross-candidate stability (common random numbers):
 *   For each persona we build one shared *candidate stream* that does not depend on the site.
 *   Its RNG is `createRng(seed).fork("demand:<catchmentId>:<dayType>:<personaId>")`, and it is a
 *   homogeneous Poisson process with rate weight * ENVELOPE_VISITS_PER_PERSON_HOUR / 60 per
 *   minute over GENERATION_WINDOW (05:00-21:00). Every candidate k in the stream always draws,
 *   in order: its gap (exponential), a thinning uniform u, a stayDraw uniform and a service time
 *   (lognormal, two uniforms). A site keeps candidate k iff u < rate_site(t) / envelope(t).
 *   The customer id is "<personaId>#<k>".
 *
 *   So for the same seed, every site sharing a catchment sees customers drawn from the same
 *   stream: a person who would visit both A and B has the same id, arrival minute, stayDraw and
 *   service time at both, and a site whose rate is higher everywhere gets a superset of
 *   customers. Thinning a Poisson process by rate(t) / envelope gives a non-homogeneous Poisson
 *   process with rate(t), so arrivals per site are still exact.
 *
 *   If a site's rate ever exceeds the envelope, it is clipped to the envelope and the number of
 *   clipped persona-hours is reported in params as "arrivals.clippedPersonaHours".
 */
import { createRng } from "../sim/random";
import type { Customer, DayType, TimeBlock } from "./contracts";
import { TIME_BLOCKS, TIME_BLOCK_HOURS } from "./contracts";
import { ENVELOPE_VISITS_PER_PERSON_HOUR, GENERATION_WINDOW } from "./defaults";

/** Options for turning time-block shares into hourly rates. */
export interface RateOptions {
  /**
   * Smooth the block step function into a continuous curve (see smoothBlockShares). Opt-in:
   * unset or false keeps the flat per-block rates, so existing results are unchanged.
   */
  smooth?: boolean;
}

/**
 * Smooth alternative to the block step function: the share of the day's visits in each clock
 * hour (24 entries, summing to 1). The blocks tile the day, so their cumulative share
 * F(t) is known exactly at every block boundary. We interpolate F with a monotone cubic
 * Hermite spline (Fritsch-Carlson): F is non-decreasing, so the density F' is non-negative
 * and continuous, and every block's total share F(end) - F(start) is preserved exactly. The
 * hourly shares are F(h + 1) - F(h). Deterministic and free of randomness.
 */
export function smoothBlockShares(timeBlocks: Record<TimeBlock, number>): number[] {
  const total = TIME_BLOCKS.reduce((s, b) => s + timeBlocks[b], 0);
  const shares = new Array<number>(24).fill(0);
  if (!(total > 0)) return shares;

  // Knots at the block boundaries (hours) with cumulative share.
  const xs: number[] = [TIME_BLOCK_HOURS[TIME_BLOCKS[0]!][0]];
  const fs: number[] = [0];
  for (const block of TIME_BLOCKS) {
    xs.push(TIME_BLOCK_HOURS[block][1]);
    fs.push((fs[fs.length - 1] ?? 0) + timeBlocks[block] / total);
  }
  const n = xs.length - 1;
  const dx = Array.from({ length: n }, (_, k) => (xs[k + 1] ?? 0) - (xs[k] ?? 0));
  const slope = Array.from({ length: n }, (_, k) => ((fs[k + 1] ?? 0) - (fs[k] ?? 0)) / (dx[k] ?? 1));

  // Tangents (the density at each knot): weighted harmonic mean of neighbouring block
  // densities, zero at a local extremum, one-sided at the ends.
  const m = new Array<number>(n + 1).fill(0);
  m[0] = slope[0] ?? 0;
  m[n] = slope[n - 1] ?? 0;
  for (let k = 1; k < n; k++) {
    const a = slope[k - 1] ?? 0;
    const b = slope[k] ?? 0;
    if (a * b <= 0) {
      m[k] = 0;
    } else {
      const w1 = 2 * (dx[k] ?? 1) + (dx[k - 1] ?? 1);
      const w2 = (dx[k] ?? 1) + 2 * (dx[k - 1] ?? 1);
      m[k] = (w1 + w2) / (w1 / a + w2 / b);
    }
  }

  const cumulative = (x: number): number => {
    if (x <= (xs[0] ?? 0)) return 0;
    if (x >= (xs[n] ?? 0)) return fs[n] ?? 1;
    let k = 0;
    while (k < n - 1 && x >= (xs[k + 1] ?? 0)) k++;
    const h = dx[k] ?? 1;
    const t = (x - (xs[k] ?? 0)) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * (fs[k] ?? 0) +
      (t3 - 2 * t2 + t) * h * (m[k] ?? 0) +
      (-2 * t3 + 3 * t2) * (fs[k + 1] ?? 0) +
      (t3 - t2) * h * (m[k + 1] ?? 0)
    );
  };

  for (let h = xs[0] ?? 0; h < (xs[n] ?? 0); h++) {
    shares[h] = Math.max(0, cumulative(h + 1) - cumulative(h));
  }
  return shares;
}

/**
 * Per-minute arrival rate for each hour of the day (24 entries), given expected visits per
 * day if the site were open through every time block. By default block shares are spread
 * evenly over the block's hours (a step function); with `smooth` they follow a continuous
 * curve with the same total per block. Opening hours are applied later by rateAt /
 * expectedVisitsByHour: visits that fall outside [openMin, closeMin) are lost (the customer
 * finds the site closed).
 */
export function ratePerMinuteByHour(
  dailyVisits: number,
  timeBlocks: Record<TimeBlock, number>,
  options: RateOptions = {},
): number[] {
  const rates = new Array<number>(24).fill(0);
  const total = TIME_BLOCKS.reduce((s, b) => s + timeBlocks[b], 0);
  if (!(total > 0) || !(dailyVisits > 0)) return rates;
  if (options.smooth) {
    const shares = smoothBlockShares(timeBlocks);
    for (let h = 0; h < 24; h++) rates[h] = (dailyVisits * (shares[h] ?? 0)) / 60;
    return rates;
  }
  for (const block of TIME_BLOCKS) {
    const [h0, h1] = TIME_BLOCK_HOURS[block];
    const perHour = (dailyVisits * (timeBlocks[block] / total)) / (h1 - h0);
    for (let h = h0; h < h1; h++) rates[h] = perHour / 60;
  }
  return rates;
}

/** Rate (per minute) at minute t, honouring opening hours. */
export function rateAt(ratesByHour: readonly number[], t: number, openMin: number, closeMin: number): number {
  if (t < openMin || t >= closeMin) return 0;
  return ratesByHour[Math.floor(t / 60)] ?? 0;
}

/** Expected visits in each clock hour (24 entries) within opening hours. */
export function expectedVisitsByHour(
  ratesByHour: readonly number[],
  openMin: number,
  closeMin: number,
): number[] {
  const out = new Array<number>(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const lo = Math.max(h * 60, openMin);
    const hi = Math.min((h + 1) * 60, closeMin);
    if (hi > lo) out[h] = (ratesByHour[h] ?? 0) * (hi - lo);
  }
  return out;
}

export interface PersonaRate {
  personaId: string;
  weight: number;
  /** Per-minute rate for each clock hour, from ratePerMinuteByHour. */
  ratesByHour: readonly number[];
}

export interface ArrivalOptions {
  seed: number;
  catchmentId: string;
  dayType: DayType;
  openMin: number;
  closeMin: number;
  serviceMeanMin: number;
  serviceCv: number;
}

export interface ArrivalResult {
  customers: Customer[];
  clippedPersonaHours: number;
}

/** Label of the shared per-persona candidate stream. */
export function streamLabel(catchmentId: string, dayType: DayType, personaId: string): string {
  return `demand:${catchmentId}:${dayType}:${personaId}`;
}

/** Seeded non-homogeneous Poisson arrivals by thinning a site-independent shared stream. */
export function generateArrivals(personas: readonly PersonaRate[], opts: ArrivalOptions): ArrivalResult {
  const root = createRng(opts.seed);
  const [w0, w1] = GENERATION_WINDOW;
  const customers: Customer[] = [];
  let clippedPersonaHours = 0;

  for (const p of personas) {
    if (!(p.weight > 0)) continue;
    const envelope = (p.weight * ENVELOPE_VISITS_PER_PERSON_HOUR) / 60;
    for (let h = 0; h < 24; h++) {
      if ((p.ratesByHour[h] ?? 0) > envelope) clippedPersonaHours++;
    }
    const rng = root.fork(streamLabel(opts.catchmentId, opts.dayType, p.personaId));
    let t = w0;
    for (let k = 0; ; k++) {
      t += rng.exponential(envelope);
      if (t >= w1) break;
      const u = rng.next();
      const stayDraw = rng.next();
      const serviceMin = rng.lognormal(opts.serviceMeanMin, opts.serviceCv);
      const rate = Math.min(envelope, rateAt(p.ratesByHour, t, opts.openMin, opts.closeMin));
      if (u < rate / envelope) {
        customers.push({ id: `${p.personaId}#${k}`, personaId: p.personaId, arrivalMin: t, stayDraw, serviceMin });
      }
    }
  }

  customers.sort((a, b) => a.arrivalMin - b.arrivalMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { customers, clippedPersonaHours };
}
