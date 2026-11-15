import { describe, expect, it } from "vitest";
import { comparisonScale } from "./comparison-chart";
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
