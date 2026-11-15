import { describe, expect, it } from "vitest";
import { comparisonScale, fittedComparisonScale } from "./comparison-chart";
describe("comparison chart signed ranges", () => {
  it("includes negative ranges and zero without reversing bars", () => {
    const scale = comparisonScale([
      { mean: -10, low: -20, high: 5 },
      { mean: 20, low: 10, high: 30 },
    ]);
    expect(scale.zero).toBe(40);
    expect(scale.position(-20)).toBe(0);
    expect(scale.position(30)).toBe(100);
  });
  it("keeps zero-only and one-valued charts finite", () => {
    const scale = comparisonScale([{ mean: 0, low: 0, high: 0 }]);
    expect(scale.position(0)).toBe(50);
    expect(Number.isFinite(scale.zero)).toBe(true);
  });
});

describe("fitted shared interval chart scale", () => {
  it("fits nearby positive ranges without forcing an unrelated zero", () => {
    const scale = fittedComparisonScale([
      { mean: 1010, low: 1000, high: 1020 },
      { mean: 1040, low: 1030, high: 1050 },
    ]);
    expect(scale.min).toBe(996);
    expect(scale.max).toBe(1054);
    expect(scale.zero).toBeNull();
    expect(scale.position(1040) - scale.position(1010)).toBeGreaterThan(50);
  });
  it("keeps a zero reference when the data crosses zero", () => {
    const scale = fittedComparisonScale([{ mean: 0, low: -100, high: 100 }]);
    expect(scale.zero).toBe(50);
    expect(scale.position(-100)).toBeGreaterThan(0);
    expect(scale.position(100)).toBeLessThan(100);
  });
  it("keeps constant and empty data finite", () => {
    expect(
      fittedComparisonScale([{ mean: 5, low: 5, high: 5 }]).position(5),
    ).toBe(50);
    expect(Number.isFinite(fittedComparisonScale([]).position(0))).toBe(true);
  });
});
