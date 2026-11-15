import { describe, expect, it } from "vitest";
import {
  chapterAt,
  experimentChoiceAt,
  onboardingAt,
  ONBOARDING_MS,
  onboardingCanPlay,
  countUpAt,
} from "./timeline";

describe("curated landing timeline", () => {
  it("covers the complete journey and clamps direct seeks", () => {
    expect(chapterAt(-1).chapter).toBe("hero");
    expect(chapterAt(Number.NaN).progress).toBe(0);
    expect(chapterAt(2).chapter).toBe("finish");
    expect(
      [0, 0.25, 0.4, 0.52, 0.63, 0.76, 0.92, 1].map(
        (p) => chapterAt(p).chapter,
      ),
    ).toEqual([
      "hero",
      "onboarding",
      "location",
      "property",
      "interior",
      "experiment",
      "return",
      "finish",
    ]);
  });
  it("enters one screen, holds it and returns to the laptop", () => {
    expect(chapterAt(0.1).entry).toBe(0);
    expect(chapterAt(0.16).entry).toBeCloseTo(0.5);
    expect(chapterAt(0.22).entry).toBe(1);
    expect(chapterAt(0.86).entry).toBe(1);
    expect(chapterAt(0.92).entry).toBeCloseTo(0.5);
    expect(chapterAt(0.97).entry).toBe(0);
    expect(chapterAt(1)).toMatchObject({
      entry: 0,
      finalOpacity: 1,
      scene: "experiment",
    });
  });
  it("is deterministic through fast forward and reverse chapter seeking", () => {
    const seeks = [0, 0.1, 0.22, 0.36, 0.48, 0.58, 0.69, 0.78, 0.87, 0.97, 1];
    expect(
      [...seeks]
        .reverse()
        .map((p) => chapterAt(p))
        .reverse(),
    ).toEqual(seeks.map((p) => chapterAt(p)));
    for (let i = 0; i <= 100; i++) {
      const frame = chapterAt(i / 100);
      for (const value of [
        frame.entry,
        frame.mapOpacity,
        frame.interiorOpacity,
        frame.overheadOpacity,
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
  it("keeps reduced motion at static camera endpoints", () => {
    expect(chapterAt(0.16, true).entry).toBe(0);
    expect(chapterAt(0.22, true).entry).toBe(1);
    expect(chapterAt(0.96, true).entry).toBe(1);
    expect(chapterAt(0.97, true).entry).toBe(0);
  });
});

describe("bounded preconfigured onboarding", () => {
  it("does not reveal or play onboarding until the MacBook screen is completely full", () => {
    expect(chapterAt(0.219).onboardingReady).toBe(false);
    expect(onboardingCanPlay(0.219, 0)).toBe(false);
    expect(chapterAt(0.22).onboardingReady).toBe(true);
    expect(onboardingCanPlay(0.22, 0)).toBe(true);
    expect(onboardingCanPlay(0.25, 0, { visible: false })).toBe(false);
    expect(onboardingCanPlay(0.25, 0, { paused: true })).toBe(false);
    expect(onboardingCanPlay(0.25, 0, { reducedMotion: true })).toBe(false);
    expect(onboardingCanPlay(0.25, 7000)).toBe(false);
  });
  it("finishes in exactly seven seconds with readable business/city/budget beats", () => {
    expect(ONBOARDING_MS).toBe(7000);
    expect(
      [0, 1200, 2400, 3600, 4800, 6000].map((ms) => onboardingAt(ms).step),
    ).toEqual(["category", "concept", "city", "budget", "staff", "review"]);
    expect(onboardingAt(6999).done).toBe(false);
    expect(onboardingAt(7000)).toMatchObject({ step: "review", done: true });
    expect(onboardingAt(-100).step).toBe("category");
  });
  it("provides the completed brief immediately for reduced motion or skipping", () => {
    expect(onboardingAt(0, true)).toMatchObject({ step: "review", done: true });
    expect(onboardingAt(ONBOARDING_MS)).toEqual(onboardingAt(20000));
    expect(onboardingAt(1200)).toEqual(onboardingAt(1200));
  });
});

describe("selected location progression", () => {
  it("moves the exterior camera normally but holds it static for reduced motion", () => {
    expect(chapterAt(0.54).exteriorZoom).toBe(1);
    expect(chapterAt(0.6).exteriorZoom).toBeGreaterThan(
      chapterAt(0.54).exteriorZoom,
    );
    expect(chapterAt(0.62).exteriorZoom).toBeCloseTo(1.1);
    expect(
      [0.54, 0.58, 0.6, 0.62].map((p) => chapterAt(p, true).exteriorZoom),
    ).toEqual([1, 1, 1, 1]);
  });
  it("moves through shortlist, selected building and exterior before the starting interior", () => {
    expect(chapterAt(0.39).mapPush).toBeLessThan(chapterAt(0.445).mapPush);
    expect(chapterAt(0.48).closeOpacity).toBe(1);
    expect(chapterAt(0.565).exteriorOpacity).toBe(1);
    expect(chapterAt(0.65).interiorOpacity).toBe(1);
    expect(chapterAt(0.65).exteriorOpacity).toBe(0);
  });
  it("counts from one to prepared rent within 700ms and uses final values under reduced motion", () => {
    expect(countUpAt(0, 3000)).toBe(1);
    expect(countUpAt(350, 3000)).toBeGreaterThan(1);
    expect(countUpAt(350, 3000)).toBeLessThan(3000);
    expect(countUpAt(700, 3000)).toBe(3000);
    expect(countUpAt(5000, 3000)).toBe(3000);
    expect(countUpAt(0, 3000, true)).toBe(3000);
    expect(countUpAt(-30, 3000)).toBe(1);
  });
});

describe("same-result experiment return", () => {
  it("plays one then two staffed counters in order and retains the result on return", () => {
    expect(experimentChoiceAt(0.72)).toBe("current");
    expect(experimentChoiceAt(0.82)).toBe("proposed");
    expect(experimentChoiceAt(1)).toBe("proposed");
  });
  it("retains an explicit replay selection through the closing laptop", () => {
    expect(experimentChoiceAt(0.82, "current")).toBe("current");
    expect(experimentChoiceAt(1, "current")).toBe("current");
    expect(experimentChoiceAt(0.72, "proposed")).toBe("proposed");
  });
});
