import { it, expect } from "vitest";
import { advancePlaybackMinute } from "./playback-clock";
it("makes operating playback readable: one modeled minute per real second at 1x", () => {
  expect(advancePlaybackMinute(504, 1000, 1, 720, true, false)).toBe(505);
  expect(advancePlaybackMinute(504, 1000, 2, 720, true, false)).toBe(506);
});
it("stops exactly at replay end and preserves the neighborhood clock rate", () => {
  expect(advancePlaybackMinute(719.8, 1000, 1, 720, true, false)).toBe(720);
  expect(advancePlaybackMinute(504, 55, 1, 1440, false, true)).toBe(505);
});
