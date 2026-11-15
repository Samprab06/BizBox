export type StoryStage =
  "hero" | "location" | "property" | "interior" | "simulation" | "return";

export const STORY_STAGES: readonly StoryStage[];

export interface StoryFrame {
  progress: number;
  phase: "intro" | "entry" | "map" | "return" | "finish";
  stage: "hero" | "location" | "return";
  /** Smoothstep-eased normal camera entry, or static 0/1 under reduced motion. */
  entryMix: number;
  heroOpacity: number;
  locationOpacity: number;
  finalOpacity: number;
  headline: "hero" | "location" | "finish" | "none";
  fullscreen: boolean;
  /** True during the return AND final hold, preserving the same live screen. */
  returning: boolean;
  reducedMotion: boolean;
}

export function storyTimeline(
  progress: number,
  options?: { reducedMotion?: boolean },
): StoryFrame;
