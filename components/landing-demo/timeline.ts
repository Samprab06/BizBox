export const ONBOARDING_MS = 7000;
export type DemoChapter =
  | "hero"
  | "onboarding"
  | "location"
  | "property"
  | "interior"
  | "experiment"
  | "return"
  | "finish";
export type ExperimentChoice = "current" | "proposed";
export const CHAPTER_TARGETS = {
  hero: 0,
  onboarding: 0.25,
  location: 0.4,
  property: 0.52,
  interior: 0.63,
  experiment: 0.73,
  return: 0.92,
  finish: 1,
} as const;
const clamp = (n: number) =>
  Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n));
export const smooth = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function chapterAt(progress: number, reducedMotion = false) {
  const p = clamp(progress);
  const chapter: DemoChapter =
    p < 0.1
      ? "hero"
      : p < 0.36
        ? "onboarding"
        : p < 0.48
          ? "location"
          : p < 0.58
            ? "property"
            : p < 0.69
              ? "interior"
              : p < 0.87
                ? "experiment"
                : p < 0.97
                  ? "return"
                  : "finish";
  const returning = p >= 0.87;
  const entry = reducedMotion
    ? Number(p >= 0.22 && p < 0.97)
    : returning
      ? 1 - smooth(0.87, 0.97, p)
      : smooth(0.1, 0.22, p);
  const scene =
    p < 0.36
      ? "onboarding"
      : p < 0.58
        ? "location"
        : p < 0.69
          ? "interior"
          : "experiment";
  return {
    progress: p,
    chapter,
    scene,
    entry,
    returning,
    heroOpacity: 1 - smooth(0.085, 0.14, p),
    finalOpacity: reducedMotion ? Number(p >= 0.97) : smooth(0.94, 0.98, p),
    mapOpacity: smooth(0.32, 0.36, p) * (1 - smooth(0.56, 0.6, p)),
    interiorOpacity: smooth(0.56, 0.6, p) * (1 - smooth(0.67, 0.71, p)),
    overheadOpacity: smooth(0.67, 0.71, p),
    experimentProgress: clamp((p - 0.69) / 0.18),
  };
}

const ONBOARDING_BEATS = [
  { step: "category", start: 0, end: 1000 },
  { step: "concept", start: 1000, end: 2200 },
  { step: "city", start: 2200, end: 3200 },
  { step: "budget", start: 3200, end: 4500 },
  { step: "staff", start: 4500, end: 5400 },
  { step: "review", start: 5400, end: 7000 },
] as const;
export type OnboardingStep = (typeof ONBOARDING_BEATS)[number]["step"];

export function onboardingAt(elapsedMs: number, reducedMotion = false) {
  const elapsed = reducedMotion
    ? ONBOARDING_MS
    : Number.isNaN(elapsedMs)
      ? 0
      : Math.min(ONBOARDING_MS, Math.max(0, elapsedMs));
  const beat =
    ONBOARDING_BEATS.find((item) => elapsed < item.end) ?? ONBOARDING_BEATS[5];
  return {
    step: beat.step,
    progress: elapsed / ONBOARDING_MS,
    stepProgress: clamp((elapsed - beat.start) / (beat.end - beat.start)),
    done: elapsed >= ONBOARDING_MS,
  };
}

export function experimentChoiceAt(
  progress: number,
  choice?: ExperimentChoice | null,
): ExperimentChoice {
  return choice ?? (progress >= 0.78 ? "proposed" : "current");
}
