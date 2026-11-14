/**
 * HAC-77: how far the one playback clock moves for a frame. Real 1× speed must
 * hold on slow GPUs too. Capping each frame gap at 100 ms made a city drawing
 * at about 4 FPS (233 ms frames) play at roughly 0.43×, so the cap now only
 * guards against stalls longer than a second. Hidden tabs pause separately.
 */
export const MAX_FRAME_GAP_MS = 1000;

/** Wall-clock milliseconds per simulated minute at 1×. */
export function msPerSimMinute(city: boolean) {
  return city ? 55 : 125;
}

export function playbackMinutes(
  elapsedMs: number,
  speed: number,
  city: boolean,
) {
  const gap = Math.min(Math.max(elapsedMs, 0), MAX_FRAME_GAP_MS);
  return (gap * speed) / msPerSimMinute(city);
}
