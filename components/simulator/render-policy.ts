export type RenderQuality = "balanced" | "detailed";

/** These affect presentation only; the seeded business simulation is unchanged. */
export const RENDER_SETTINGS = {
  balanced: {
    maxPixelRatio: 1,
    tileError: 16,
    dynamicScreenSpaceError: true,
    cacheBytes: 128 * 1024 * 1024,
    maximumCacheOverflowBytes: 64 * 1024 * 1024,
    volumetricClouds: false,
    overlayStepMinutes: 5,
  },
  detailed: {
    maxPixelRatio: Number.POSITIVE_INFINITY,
    tileError: 1,
    dynamicScreenSpaceError: false,
    // Original Cesium26.5 defaults used by the visualization branch.
    cacheBytes: 512 * 1024 * 1024,
    maximumCacheOverflowBytes: 512 * 1024 * 1024,
    volumetricClouds: true,
    overlayStepMinutes: 1,
  },
} as const;

/** Cesium's native-density buffer is multiplied by this scale. */
export function resolutionScaleFor(
  devicePixelRatio: number,
  maxPixelRatio: number,
) {
  const density =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(1, maxPixelRatio / density);
}

/** Sample expensive visual updates without making backward timeline seeks sticky. */
export function createTimelineSampler() {
  let previous: number | undefined;
  let previousStep: number | undefined;
  return {
    take(minute: number, stepMinutes: number) {
      const sampled = Math.floor(minute / stepMinutes) * stepMinutes;
      if (sampled === previous && stepMinutes === previousStep)
        return undefined;
      previous = sampled;
      previousStep = stepMinutes;
      return sampled;
    },
    reset() {
      previous = undefined;
      previousStep = undefined;
    },
  };
}
