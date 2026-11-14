import { describe, expect, it } from "vitest";
import type { TimeBlock } from "./contracts";
import { TIME_BLOCKS, TIME_BLOCK_HOURS } from "./contracts";
import { CATEGORY_DEFAULTS } from "./defaults";
import { huffInput, jevInput } from "./fixtures";
import { generateArrivals, ratePerMinuteByHour, smoothBlockShares } from "./arrivals";
import { buildArrivalSchedule, estimateDemand } from "./model";

const BLOCKS: Record<TimeBlock, number> = {
  early_morning: 0.1,
  morning: 0.4,
  midday: 0.2,
  afternoon: 0.2,
  evening: 0.1,
};

function blockTotals(shares: readonly number[]): Record<TimeBlock, number> {
  const out = {} as Record<TimeBlock, number>;
  for (const b of TIME_BLOCKS) {
    const [h0, h1] = TIME_BLOCK_HOURS[b];
    out[b] = shares.slice(h0, h1).reduce((s, v) => s + v, 0);
  }
  return out;
}

describe("smoothBlockShares", () => {
  it("keeps every block's total share and is non-negative", () => {
    for (const day of ["weekday", "weekend"] as const) {
      for (const cat of Object.values(CATEGORY_DEFAULTS)) {
        const blocks = cat.timeBlocks[day];
        const shares = smoothBlockShares(blocks);
        const totals = blockTotals(shares);
        for (const b of TIME_BLOCKS) expect(totals[b]).toBeCloseTo(blocks[b], 12);
        for (const v of shares) expect(v).toBeGreaterThanOrEqual(0);
        expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it("is not a step function and peaks inside the morning block", () => {
    const shares = smoothBlockShares(BLOCKS);
    // The unsmoothed morning hours are all 0.4 / 3; smoothing varies them.
    expect(new Set(shares.slice(8, 11).map((v) => v.toFixed(6))).size).toBeGreaterThan(1);
    const peak = shares.indexOf(Math.max(...shares));
    expect(peak).toBeGreaterThanOrEqual(8);
    expect(peak).toBeLessThan(11);
    // No hour outside the generation window gets visits.
    expect(shares.slice(0, 5).concat(shares.slice(21)).every((v) => v === 0)).toBe(true);
  });

  it("handles zero-share blocks and a zero total", () => {
    const shares = smoothBlockShares({ ...BLOCKS, early_morning: 0, evening: 0, morning: 0.5, midday: 0.5, afternoon: 0 });
    const totals = blockTotals(shares);
    expect(totals.early_morning).toBeCloseTo(0, 12);
    expect(totals.afternoon).toBeCloseTo(0, 12);
    expect(shares.every((v) => v >= 0)).toBe(true);
    expect(smoothBlockShares({ early_morning: 0, morning: 0, midday: 0, afternoon: 0, evening: 0 }).every((v) => v === 0)).toBe(true);
  });

  it("is deterministic", () => {
    expect(smoothBlockShares(BLOCKS)).toEqual(smoothBlockShares({ ...BLOCKS }));
  });
});

describe("ratePerMinuteByHour smoothing", () => {
  it("defaults to the flat per-block step function", () => {
    const flat = ratePerMinuteByHour(100, BLOCKS);
    expect(ratePerMinuteByHour(100, BLOCKS, {})).toEqual(flat);
    expect(ratePerMinuteByHour(100, BLOCKS, { smooth: false })).toEqual(flat);
    // morning: 100 * 0.4 spread over 3 hours, per minute.
    expect(flat[9]).toBeCloseTo((100 * 0.4) / 3 / 60, 12);
    expect(flat[4]).toBe(0);
  });

  it("keeps each block's expected visits when smoothed (within 1 visit)", () => {
    const flat = blockTotals(ratePerMinuteByHour(150, BLOCKS).map((r) => r * 60));
    const smooth = blockTotals(ratePerMinuteByHour(150, BLOCKS, { smooth: true }).map((r) => r * 60));
    for (const b of TIME_BLOCKS) expect(Math.abs(smooth[b] - flat[b])).toBeLessThan(1);
  });
});

/** The pre-smoothing rate formula (HAC-18), kept here to pin the default behaviour. */
function legacyRatePerMinuteByHour(dailyVisits: number, timeBlocks: Record<TimeBlock, number>): number[] {
  const rates = new Array<number>(24).fill(0);
  const total = TIME_BLOCKS.reduce((s, b) => s + timeBlocks[b], 0);
  if (!(total > 0) || !(dailyVisits > 0)) return rates;
  for (const block of TIME_BLOCKS) {
    const [h0, h1] = TIME_BLOCK_HOURS[block];
    const perHour = (dailyVisits * (timeBlocks[block] / total)) / (h1 - h0);
    for (let h = h0; h < h1; h++) rates[h] = perHour / 60;
  }
  return rates;
}

describe("smoothing off is identical to the unsmoothed model", () => {
  for (const source of ["jev", "huff"] as const) {
    for (const dayType of ["weekday", "weekend"] as const) {
      it(`${source} ${dayType}`, () => {
        const input = source === "jev" ? jevInput() : huffInput();
        const req = { seed: 42, dayType, openMin: 360, closeMin: 1140 };
        const off = buildArrivalSchedule(input, req);
        expect(JSON.stringify(buildArrivalSchedule(input, { ...req, smoothTimeBlocks: false }))).toBe(JSON.stringify(off));
        expect(off.params["arrivals.smoothed"]).toBeUndefined();

        // Rebuild the customers from the legacy rate formula: they must match exactly.
        const estimate = estimateDemand(input);
        const legacy = generateArrivals(
          estimate.personas.map((p) => ({
            personaId: p.personaId,
            weight: p.weight,
            ratesByHour: legacyRatePerMinuteByHour(p.dailyVisits[dayType], p.timeBlocks[dayType]),
          })),
          {
            seed: req.seed,
            catchmentId: estimate.catchmentId,
            dayType,
            openMin: req.openMin,
            closeMin: req.closeMin,
            serviceMeanMin: estimate.serviceMeanMin.value,
            serviceCv: estimate.serviceCv.value,
          },
        );
        expect(off.customers).toEqual(legacy.customers);
        expect(off.customers.length).toBeGreaterThan(0);
        for (const p of estimate.personas) {
          expect(ratePerMinuteByHour(p.dailyVisits[dayType], p.timeBlocks[dayType])).toEqual(
            legacyRatePerMinuteByHour(p.dailyVisits[dayType], p.timeBlocks[dayType]),
          );
        }
      });
    }
  }

  it("smoothing on changes the schedule, is flagged, and is seeded", () => {
    // Open through every block, so opening hours do not cut a block in two.
    const req = { seed: 42, dayType: "weekday" as const, openMin: 300, closeMin: 1260 };
    const off = buildArrivalSchedule(jevInput(), req);
    const on = buildArrivalSchedule(jevInput(), { ...req, smoothTimeBlocks: true });
    expect(JSON.stringify(on)).not.toBe(JSON.stringify(off));
    expect(on.params["arrivals.smoothed"]?.value).toBe(1);
    expect(JSON.stringify(buildArrivalSchedule(jevInput(), { ...req, smoothTimeBlocks: true }))).toBe(JSON.stringify(on));
    const total = (s: typeof on) => s.params["expected.dailyCustomers"]?.value ?? 0;
    expect(total(on)).toBeCloseTo(total(off), 6);
  });
});
