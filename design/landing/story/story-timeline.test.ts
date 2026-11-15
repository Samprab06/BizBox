import { describe, expect, it } from "vitest";
import { STORY_STAGES, storyTimeline } from "./story-timeline.js";

describe("landing entry, map hold and closing return", () => {
  it("clamps direct, invalid and out-of-range seeks", () => {
    expect(storyTimeline(-1).progress).toBe(0);
    expect(storyTimeline(2).progress).toBe(1);
    expect(storyTimeline(Number.NaN).progress).toBe(0);
    expect(storyTimeline(Number.POSITIVE_INFINITY).progress).toBe(1);
    expect(storyTimeline(Number.NEGATIVE_INFINITY).progress).toBe(0);
  });

  it("holds the hero then continuously enters the same screen by 0.68", () => {
    expect(storyTimeline(0).entryMix).toBe(0);
    expect(storyTimeline(0.12).entryMix).toBe(0);
    expect(storyTimeline(0.4).entryMix).toBeCloseTo(0.5);
    expect(storyTimeline(0.68)).toMatchObject({
      stage: "location",
      entryMix: 1,
      fullscreen: true,
    });
    expect(storyTimeline(0.85).entryMix).toBe(1);
    expect(storyTimeline(0.679).fullscreen).toBe(false);
  });

  it("keeps the two headlines separate and clears both for the full-screen UI", () => {
    expect(storyTimeline(0)).toMatchObject({
      headline: "hero",
      heroOpacity: 1,
      locationOpacity: 0,
    });
    expect(storyTimeline(0.45)).toMatchObject({
      headline: "location",
      heroOpacity: 0,
      locationOpacity: 1,
    });
    for (const p of [0.68, 0.8]) {
      expect(storyTimeline(p)).toMatchObject({
        headline: "none",
        heroOpacity: 0,
        locationOpacity: 0,
      });
    }
    for (let i = 0; i <= 100; i++) {
      const frame = storyTimeline(i / 100);
      expect(frame.heroOpacity * frame.locationOpacity).toBe(0);
    }
  });

  it("holds the actual map before returning without replaying entry copy", () => {
    for (const p of [0.68, 0.8, 0.859]) {
      expect(storyTimeline(p)).toMatchObject({
        phase: "map",
        stage: "location",
        entryMix: 1,
        fullscreen: true,
        returning: false,
        headline: "none",
      });
    }
    expect(storyTimeline(0.86)).toMatchObject({
      phase: "return",
      stage: "return",
      entryMix: 1,
      fullscreen: false,
      returning: true,
      heroOpacity: 0,
      locationOpacity: 0,
    });
    expect(storyTimeline(0.92).entryMix).toBeCloseTo(0.5);
  });

  it("settles back on the laptop and keeps the final copy visible after fullscreen", () => {
    expect(storyTimeline(0.96).finalOpacity).toBeCloseTo(0.5);
    for (const p of [0.98, 1, 2]) {
      expect(storyTimeline(p)).toMatchObject({
        phase: "finish",
        stage: "return",
        entryMix: 0,
        fullscreen: false,
        returning: true,
        headline: "finish",
        finalOpacity: 1,
        heroOpacity: 0,
        locationOpacity: 0,
      });
    }
  });

  it("returns the same frame after fast forward and reverse seeks", () => {
    const seeks = [0, 0.12, 0.3, 0.54, 0.68, 0.8, 0.86, 0.92, 0.96, 0.98, 1];
    const forward = seeks.map((p) => storyTimeline(p));
    const reverse = [...seeks].reverse().map((p) => storyTimeline(p));
    expect(reverse.reverse()).toEqual(forward);
  });

  it("uses static endpoints and readable static copy under reduced motion", () => {
    expect(storyTimeline(0.4).entryMix).toBeGreaterThan(0);
    expect(storyTimeline(0.4, { reducedMotion: true })).toMatchObject({
      entryMix: 0,
      headline: "location",
      locationOpacity: 1,
    });
    for (let i = 0; i <= 100; i++) {
      const frame = storyTimeline(i / 100, { reducedMotion: true });
      expect([0, 1]).toContain(frame.entryMix);
      expect([0, 1]).toContain(frame.heroOpacity);
      expect([0, 1]).toContain(frame.locationOpacity);
      expect([0, 1]).toContain(frame.finalOpacity);
    }
    expect(storyTimeline(0.68, { reducedMotion: true })).toMatchObject({
      entryMix: 1,
      fullscreen: true,
      headline: "none",
    });
  });

  it("holds the static fullscreen frame until 0.98 under reduced motion", () => {
    expect(storyTimeline(0.97, { reducedMotion: true })).toMatchObject({
      phase: "return",
      entryMix: 1,
      returning: true,
      locationOpacity: 0,
      finalOpacity: 0,
    });
    expect(storyTimeline(0.98, { reducedMotion: true })).toMatchObject({
      phase: "finish",
      entryMix: 0,
      headline: "finish",
      finalOpacity: 1,
    });
  });

  it("reserves the approved later stages without pretending this slice implements them", () => {
    expect(STORY_STAGES).toEqual([
      "hero",
      "location",
      "property",
      "interior",
      "simulation",
      "return",
    ]);
    expect(storyTimeline(1).stage).toBe("return");
    expect(storyTimeline(0.1).phase).toBe("intro");
    expect(storyTimeline(0.4).phase).toBe("entry");
  });
});
