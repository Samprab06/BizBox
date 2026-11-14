import { expect, it } from "vitest";
import { smoothAudioLevel, waveformLevel } from "./audio-level";
it("keeps silence and invalid samples still while normalizing audible input", () => {
  expect(waveformLevel(new Float32Array(512))).toBe(0);
  expect(waveformLevel(new Float32Array([NaN]))).toBe(0);
  expect(waveformLevel(new Float32Array(512).fill(0.22))).toBeCloseTo(1, 6);
  expect(waveformLevel(new Float32Array(512).fill(0.05))).toBeGreaterThan(0);
});
it("attacks faster than it releases and remains bounded", () => {
  expect(smoothAudioLevel(0, 1, 0.035)).toBeGreaterThan(0.6);
  expect(smoothAudioLevel(1, 0, 0.035)).toBeGreaterThan(0.8);
  expect(smoothAudioLevel(1, 0, 1)).toBeLessThan(0.03);
});
