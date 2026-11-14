import { describe, expect, it } from "vitest";
import { MAX_FRAME_GAP_MS, msPerSimMinute, playbackMinutes } from "./playback";

const advance = (frameMs: number, seconds: number, speed = 1) => {
  let total = 0;
  for (let t = 0; t + frameMs <= seconds * 1000; t += frameMs)
    total += playbackMinutes(frameMs, speed, true);
  return total;
};

describe("playback clock", () => {
  it("keeps real 1× speed whether the city draws at 60 or 4 FPS", () => {
    const expected = 8000 / msPerSimMinute(true);
    expect(advance(1000 / 60, 8)).toBeCloseTo(expected, 0);
    // HAC-70 measured 233 ms frames on an Intel HD 520; this used to give ~62.
    expect(advance(233, 8)).toBeGreaterThan(expected * 0.95);
  });

  it("scales with speed", () => {
    expect(playbackMinutes(100, 4, true)).toBeCloseTo(
      4 * playbackMinutes(100, 1, true),
    );
  });

  it("caps a single stall and ignores negative gaps", () => {
    expect(playbackMinutes(60_000, 1, true)).toBe(
      MAX_FRAME_GAP_MS / msPerSimMinute(true),
    );
    expect(playbackMinutes(-5, 1, true)).toBe(0);
  });

  it("keeps the café-only pace", () => {
    expect(playbackMinutes(125, 1, false)).toBe(1);
  });
});
