/**
 * The complete approved story order is reserved here for future adapters.
 * This additive slice implements hero → location → return; it adds no placeholder
 * property, interior or simulation chapters to the visible experience.
 */
export const STORY_STAGES = Object.freeze([
  "hero",
  "location",
  "property",
  "interior",
  "simulation",
  "return",
]);

const clamp = (value) =>
  Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

/**
 * Pure, reversible frame contract consumed by the page shell and scene engine.
 * The shell emits this object as `bizbox:story-progress` event.detail and keeps
 * the latest object at window.bizboxStory.getState() for late engine startup.
 * entryMix is already smoothstep-eased: the camera should not ease it again.
 */
export function storyTimeline(progress, { reducedMotion = false } = {}) {
  const p = clamp(progress);
  const returning = p >= 0.86;
  const fullscreen = p >= 0.68 && !returning;
  const phase =
    p < 0.12
      ? "intro"
      : p < 0.68
        ? "entry"
        : p < 0.86
          ? "map"
          : p < 0.98
            ? "return"
            : "finish";
  const heroOpacity = reducedMotion
    ? Number(p < 0.3)
    : 1 - smooth(0.12, 0.26, p);
  const locationOpacity = reducedMotion
    ? Number(p >= 0.3 && p < 0.68)
    : smooth(0.3, 0.4, p) * (1 - smooth(0.54, 0.68, p));
  const finalOpacity = reducedMotion
    ? Number(p >= 0.98)
    : smooth(0.94, 0.98, p);
  const entryMix = reducedMotion
    ? Number(p >= 0.68 && p < 0.98)
    : returning
      ? 1 - smooth(0.86, 0.98, p)
      : smooth(0.12, 0.68, p);
  return {
    progress: p,
    phase,
    stage: returning ? "return" : p < 0.12 ? "hero" : "location",
    entryMix,
    heroOpacity,
    locationOpacity,
    finalOpacity,
    headline:
      heroOpacity > 0
        ? "hero"
        : locationOpacity > 0
          ? "location"
          : finalOpacity > 0
            ? "finish"
            : "none",
    fullscreen,
    // Stays true during final hold so the engine retains the same live screen.
    returning,
    reducedMotion,
  };
}
