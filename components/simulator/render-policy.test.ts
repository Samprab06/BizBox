import { describe, expect, it } from "vitest";
import { createTimelineSampler, resolutionScaleFor } from "./render-policy";

describe("scene pixel budget", () => {
  it("caps a high-density display without enlarging low-density output", () => {
    expect(resolutionScaleFor(2, 1)).toBe(0.5);
    expect(resolutionScaleFor(1, 1)).toBe(1);
    expect(resolutionScaleFor(0.75, 1)).toBe(1);
    expect(resolutionScaleFor(3, 2)).toBeCloseTo(2 / 3);
  });

  it("keeps a usable resolution when the browser reports invalid density", () => {
    expect(resolutionScaleFor(0, 1)).toBe(1);
    expect(resolutionScaleFor(Number.NaN, 1)).toBe(1);
    expect(resolutionScaleFor(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });
});

describe("visual timeline sampling", () => {
  it("skips redundant geometry updates but accepts forward and backward seeks", () => {
    const sample = createTimelineSampler();
    expect(sample.take(360, 5)).toBe(360);
    expect(sample.take(361.5, 5)).toBeUndefined();
    expect(sample.take(365, 5)).toBe(365);
    expect(sample.take(300, 5)).toBe(300);
  });

  it("refreshes when quality changes or newly loaded geometry needs the current state", () => {
    const sample = createTimelineSampler();
    expect(sample.take(360, 5)).toBe(360);
    expect(sample.take(360, 1)).toBe(360);
    expect(sample.take(360.1, 1)).toBeUndefined();
    sample.reset();
    expect(sample.take(360.1, 1)).toBe(360);
  });
});
