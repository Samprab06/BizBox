import { describe, expect, it } from "vitest";
import { onboardingInputAt } from "./story-onboarding-model";

describe("scripted business inputs", () => {
  it("selects the café before writing the brief, then adjusts the rent and shift", () => {
    expect(onboardingInputAt(0).categorySelected).toBe(false);
    expect(onboardingInputAt(600).categorySelected).toBe(true);
    expect(onboardingInputAt(1800).conceptMix).toBeGreaterThan(0);
    expect(onboardingInputAt(1800).conceptMix).toBeLessThan(1);
    expect(onboardingInputAt(3200).rentMix).toBe(0);
    expect(onboardingInputAt(3900).rentMix).toBeGreaterThan(0);
    expect(onboardingInputAt(4500).rentMix).toBe(1);
    expect(onboardingInputAt(4500).staffOffset).toBe(1);
    expect(onboardingInputAt(5200).staffOffset).toBe(0);
  });
  it("confirms only after the inputs settle, with final data under reduced motion", () => {
    expect(onboardingInputAt(5000).locked).toBe(false);
    expect(onboardingInputAt(6500).locked).toBe(true);
    const reduced = onboardingInputAt(0, true);
    expect(reduced).toMatchObject({
      step: "review",
      conceptMix: 1,
      rentMix: 1,
      staffOffset: 0,
      locked: true,
      progress: 1,
    });
  });
  it("supports reverse seek and contains invalid/out-of-range times", () => {
    expect(onboardingInputAt(7000).step).toBe("review");
    expect(onboardingInputAt(3500).step).toBe("budget");
    expect(onboardingInputAt(1100).step).toBe("concept");
    expect(onboardingInputAt(-1)).toEqual(onboardingInputAt(0));
    expect(onboardingInputAt(NaN)).toEqual(onboardingInputAt(0));
    expect(onboardingInputAt(Infinity)).toEqual(onboardingInputAt(0));
  });
});
