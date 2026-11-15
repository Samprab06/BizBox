/** Readable person movement at 1x; this display clock never changes engine events. */
export function advancePlaybackMinute(
  minute: number,
  elapsedMs: number,
  speed: number,
  end: number,
  operating: boolean,
  hasNeighborhood: boolean,
): number {
  const msPerMinute = operating ? 1000 : hasNeighborhood ? 55 : 125;
  return Math.min(end, minute + (Math.max(0, elapsedMs) * speed) / msPerMinute);
}
