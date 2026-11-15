import { smooth } from "../landing-demo/timeline";

/** Seven-second authored demonstration; values settle before the brief is locked. */
export function onboardingInputAt(input: number, reduced = false) {
  const ms = reduced
    ? 7000
    : Number.isFinite(input)
      ? Math.max(0, Math.min(7000, input))
      : 0;
  return {
    step:
      ms < 900
        ? "category"
        : ms < 3100
          ? "concept"
          : ms < 5500
            ? "budget"
            : "review",
    categorySelected: ms >= 450,
    conceptMix: Math.min(1, Math.max(0, (ms - 1050) / 1800)),
    rentMix: smooth(3300, 4450, ms),
    staffOffset: Number(ms < 4850),
    locked: ms >= 6250,
    progress: ms / 7000,
  } as const;
}
