import { smooth } from "../landing-demo/timeline";
export const ONBOARDING_MS = 7000;
export const CHAPTERS = [
  { id: "hero", at: 0, label: "Home" },
  { id: "onboarding", at: 0.06, label: "Your business" },
  { id: "question", at: 0.24, label: "Your question" },
  { id: "locations", at: 0.3, label: "Locations" },
  { id: "morning", at: 0.4, label: "The same morning" },
  { id: "analytics", at: 0.49, label: "Compare results" },
  { id: "consultant", at: 0.58, label: "Consultant" },
  { id: "interior", at: 0.66, label: "See inside" },
  { id: "counter-question", at: 0.76, label: "Test a change" },
  { id: "counters", at: 0.82, label: "One or two counters" },
  { id: "return", at: 0.93, label: "Open BizBox" },
] as const;
export type StoryChapter = (typeof CHAPTERS)[number]["id"];
export function storyAt(input: number, reduced = false) {
  const p = Number.isFinite(input) ? Math.min(1, Math.max(0, input)) : 0;
  const chapter = [...CHAPTERS].reverse().find((c) => p >= c.at) ?? CHAPTERS[0];
  const index = CHAPTERS.indexOf(chapter);
  const end = CHAPTERS[index + 1]?.at ?? 1;
  const local = Math.min(
    1,
    (p - chapter.at) / Math.max(0.001, end - chapter.at),
  );
  const entering = smooth(0.06, 0.14, p);
  const entry = reduced
    ? Number(p >= 0.14 && p < 0.995)
    : p >= 0.93
      ? 1 - smooth(0.94, 0.995, p)
      : entering;
  return {
    progress: p,
    chapter: chapter.id,
    index,
    local,
    entry,
    onboardingReady: chapter.id === "onboarding" && entry === 1,
    outdoors: chapter.id === "locations" || chapter.id === "morning",
    heroOpacity: 1 - smooth(0.04, 0.085, p),
    finalOpacity: reduced ? Number(p >= 0.995) : smooth(0.97, 0.998, p),
    interiorPan: reduced ? 0 : smooth(0.715, 0.78, p),
    cursorMix: reduced ? 1 : smooth(0.66, 0.686, p),
    interiorMix: reduced ? Number(p >= 0.69) : smooth(0.69, 0.735, p),
  };
}
export type PlaybackGate = {
  active: boolean;
  visible: boolean;
  paused: boolean;
  reduced: boolean;
};
export function activeTime(
  current: number,
  delta: number,
  gate: PlaybackGate,
  limit: number,
) {
  return gate.active && gate.visible && !gate.paused && !gate.reduced
    ? Math.min(limit, current + Math.max(0, delta))
    : current;
}
export function typingAt(
  text: string,
  elapsed: number,
  delay = 0,
  reduced = false,
) {
  return reduced
    ? text
    : text.slice(0, Math.max(0, Math.floor((elapsed - delay) / 25)));
}

export function chapterTarget(chapter: StoryChapter) {
  const target = CHAPTERS.find((item) => item.id === chapter)!;
  return chapter === "onboarding"
    ? 0.17
    : chapter === "hero"
      ? 0
      : chapter === "return"
        ? 0.998
        : target.at + 0.001;
}

export function scrollOffset(
  progress: number,
  scrollHeight: number,
  viewportHeight: number,
) {
  return (
    Math.min(1, Math.max(0, progress)) *
    Math.max(1, scrollHeight - viewportHeight)
  );
}

export type LocationSpace = "question" | "map" | "analytics" | null;
const spacePosition = (scene: LocationSpace) =>
  scene === "question" ? -1 : Number(scene === "analytics");
export type SpaceSlide = {
  scene: LocationSpace;
  from: number;
  to: number;
  startedAt: number;
  duration: number;
  suspended?: boolean;
};
export function initialSpaceSlide(scene: LocationSpace): SpaceSlide {
  const mix = spacePosition(scene);
  return { scene, from: mix, to: mix, startedAt: 0, duration: 0 };
}
export function spaceSlideAt(state: SpaceSlide, now: number) {
  const t = state.duration
    ? Math.min(1, Math.max(0, (now - state.startedAt) / state.duration))
    : 1;
  const mix = state.from + (state.to - state.from) * smooth(0, 1, t);
  const active = t < 1 && state.from !== state.to;
  const transitioning = active || !!state.suspended;
  return {
    scene: state.scene,
    mix,
    active,
    retainMap: state.scene === "map" || (state.scene !== null && transitioning),
    retainQuestion:
      state.scene === "question" ||
      (transitioning && Math.min(state.from, state.to) < 0),
    retainAnalytics:
      state.scene === "analytics" ||
      (transitioning && Math.max(state.from, state.to) > 0),
  };
}
export function holdSpaceSlide(state: SpaceSlide, now: number): SpaceSlide {
  const frame = spaceSlideAt(state, now);
  return {
    ...state,
    from: frame.mix,
    to: frame.mix,
    startedAt: now,
    duration: 0,
    suspended: frame.active || state.suspended,
  };
}
export function retargetSpaceSlide(
  previous: SpaceSlide,
  scene: LocationSpace,
  now: number,
  animate: boolean,
): SpaceSlide {
  if (
    !animate ||
    scene === null ||
    previous.scene === null ||
    Math.abs(spacePosition(scene) - spacePosition(previous.scene)) > 1
  )
    return initialSpaceSlide(scene);
  if (previous.scene === scene && !previous.suspended) return previous;
  return {
    scene,
    from: spaceSlideAt(previous, now).mix,
    to: spacePosition(scene),
    startedAt: now,
    duration: 500,
  };
}

/** Bounded, deterministic chat beats shared by all three scripted questions. */
export function chatSchedule(prompt: string, paragraphs: readonly string[]) {
  const sendAt = 250 + prompt.length * 25 + 220;
  const sentAt = sendAt + 180;
  const replyAt = sentAt + 420;
  return {
    sendAt,
    sentAt,
    replyAt,
    duration: replyAt + paragraphs.join("\n\n").length * 22 + 250,
  };
}
export function chatAt(
  prompt: string,
  paragraphs: readonly string[],
  elapsed: number,
  reduced = false,
) {
  const schedule = chatSchedule(prompt, paragraphs);
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const sent = reduced || time >= schedule.sentAt;
  const replyVisible = reduced || time >= schedule.replyAt;
  let remaining = reduced
    ? Infinity
    : Math.max(0, Math.floor((time - schedule.replyAt) / 22));
  const typed = paragraphs.map((paragraph) => {
    const text = paragraph.slice(0, Math.max(0, remaining));
    remaining -= paragraph.length + 2;
    return text;
  });
  return {
    promptText: reduced ? prompt : typingAt(prompt, time, 250),
    sendPressed: !reduced && time >= schedule.sendAt && time < schedule.sentAt,
    sent,
    replyVisible,
    paragraphs: typed,
    complete: reduced || time >= schedule.duration,
  };
}
type SlideScheduler = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};
/** At most500ms of RAF work. Disposal also makes already-queued callbacks inert. */
export function runSpaceSlide(
  state: SpaceSlide,
  onFrame: (value: ReturnType<typeof spaceSlideAt>) => void,
  scheduler: SlideScheduler,
) {
  let pending: number | undefined;
  let disposed = false;
  const tick = (time: number) => {
    if (disposed) return;
    pending = undefined;
    const frame = spaceSlideAt(state, time);
    onFrame(frame);
    if (frame.active) pending = scheduler.request(tick);
  };
  tick(scheduler.now());
  return () => {
    disposed = true;
    if (pending !== undefined) scheduler.cancel(pending);
  };
}

/** Native Window methods must keep their browser call receiver, rather than
 * becoming methods of the injected scheduler object. */
export function browserSlideScheduler() {
  return {
    now: () => performance.now(),
    request: (callback: FrameRequestCallback) =>
      requestAnimationFrame(callback),
    cancel: (id: number) => cancelAnimationFrame(id),
  };
}
