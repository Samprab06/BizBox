import { describe, it, expect, vi } from "vitest";
import {
  storyAt,
  initialSpaceSlide,
  browserSlideScheduler,
  retargetSpaceSlide,
  spaceSlideAt,
  runSpaceSlide,
  chapterTarget,
  scrollOffset,
  CHAPTERS,
  typingAt,
  activeTime,
  chatAt,
  chatSchedule,
  holdSpaceSlide,
  ONBOARDING_MS,
} from "./timeline";

describe("location story timeline", () => {
  it("has eleven complete reversible beats with stable direct seeks", () => {
    expect(CHAPTERS).toHaveLength(11);
    const samples = CHAPTERS.map((c) => c.at + 0.001);
    expect(samples.map((p) => storyAt(p).chapter)).toEqual(
      CHAPTERS.map((c) => c.id),
    );
    expect(samples.map((p) => storyAt(p))).toEqual(
      [...samples]
        .reverse()
        .map((p) => storyAt(p))
        .reverse(),
    );
    expect(storyAt(NaN).progress).toBe(0);
    expect(storyAt(2).chapter).toBe("return");
  });
  it("gates the montage until full entry and keeps a continuous camera on return", () => {
    expect(storyAt(0.1399).onboardingReady).toBe(false);
    expect(storyAt(0.14).onboardingReady).toBe(true);
    expect(storyAt(0.24).onboardingReady).toBe(false);
    expect(storyAt(0.94).entry).toBe(1);
    expect(storyAt(1).entry).toBe(0);
    expect(Math.abs(storyAt(0.999999).entry - storyAt(1).entry)).toBeLessThan(
      0.001,
    );
  });
  it("bounds active time and freezes hidden/paused/completed work", () => {
    expect(
      activeTime(
        6900,
        200,
        { active: true, visible: true, paused: false, reduced: false },
        ONBOARDING_MS,
      ),
    ).toBe(7000);
    for (const gate of [
      { visible: false },
      { paused: true },
      { active: false },
      { reduced: true },
    ]) {
      expect(
        activeTime(
          300,
          80,
          {
            active: true,
            visible: true,
            paused: false,
            reduced: false,
            ...gate,
          },
          7000,
        ),
      ).toBe(300);
    }
  });
  it("shows a speech bubble before consultant text and offers a static reduced path", () => {
    expect(typingAt("A useful finding.", 300, 350)).toBe("");
    expect(typingAt("A useful finding.", 430, 350)).toBe("A u");
    expect(typingAt("A useful finding.", 5000, 350)).toBe("A useful finding.");
    expect(typingAt("A useful finding.", 0, 350, true)).toBe(
      "A useful finding.",
    );
    expect(storyAt(0.1, true).entry).toBe(0);
    expect(storyAt(0.14, true).entry).toBe(1);
    expect(storyAt(0.99, true).entry).toBe(1);
    expect(storyAt(1, true).entry).toBe(0);
  });
  it("makes keyboard/button chapter targets usable, including fully entered onboarding", () => {
    for (const chapter of CHAPTERS) {
      const target = storyAt(chapterTarget(chapter.id));
      expect(target.chapter).toBe(chapter.id);
      if (chapter.id === "onboarding")
        expect(target.onboardingReady).toBe(true);
    }
  });
  it("preserves the same chapter through viewport and orientation changes", () => {
    for (const chapter of CHAPTERS) {
      const p = chapterTarget(chapter.id);
      for (const height of [375, 844, 900]) {
        const documentHeight = height * 12.5;
        const resizedProgress =
          scrollOffset(p, documentHeight, height) / (documentHeight - height);
        expect(storyAt(resizedProgress).chapter).toBe(chapter.id);
      }
    }
  });
  it("mounts exactly one outdoor map only for the location and morning beats", () => {
    expect(
      CHAPTERS.filter((c) => storyAt(c.at + 0.001).outdoors).map((c) => c.id),
    ).toEqual(["locations", "morning"]);
  });
});

describe("bounded location Spaces transition", () => {
  it("swipes prompt to map, reverses continuously, and never retains map after prompt settles", () => {
    const forward = retargetSpaceSlide(
      initialSpaceSlide("question"),
      "map",
      0,
      true,
    );
    expect(spaceSlideAt(forward, 0)).toMatchObject({
      mix: -1,
      retainMap: true,
      retainQuestion: true,
    });
    expect(spaceSlideAt(forward, 250).mix).toBeCloseTo(-0.5);
    const reverse = retargetSpaceSlide(forward, "question", 250, true);
    expect(spaceSlideAt(reverse, 250).mix).toBeCloseTo(-0.5);
    expect(spaceSlideAt(reverse, 750)).toMatchObject({
      mix: -1,
      retainMap: false,
      retainQuestion: true,
      active: false,
    });
  });
  it("freezes a paused swipe without losing either pane and resumes from its held position", () => {
    const forward = retargetSpaceSlide(
      initialSpaceSlide("question"),
      "map",
      0,
      true,
    );
    const held = holdSpaceSlide(forward, 200);
    expect(spaceSlideAt(held, 5000)).toMatchObject({
      active: false,
      retainQuestion: true,
      retainMap: true,
    });
    expect(spaceSlideAt(held, 5000).mix).toBeCloseTo(
      spaceSlideAt(forward, 200).mix,
    );
    const resumed = retargetSpaceSlide(held, "map", 5000, true);
    expect(spaceSlideAt(resumed, 5000).mix).toBeCloseTo(
      spaceSlideAt(held, 5000).mix,
    );
    expect(spaceSlideAt(resumed, 5500)).toMatchObject({
      mix: 0,
      retainQuestion: false,
      retainMap: true,
    });
  });
  it("retains outgoing map for500ms then releases it", () => {
    const state = retargetSpaceSlide(
      initialSpaceSlide("map"),
      "analytics",
      100,
      true,
    );
    expect(spaceSlideAt(state, 100)).toMatchObject({
      mix: 0,
      active: true,
      retainMap: true,
    });
    expect(spaceSlideAt(state, 350).mix).toBeCloseTo(0.5);
    expect(spaceSlideAt(state, 600)).toMatchObject({
      mix: 1,
      active: false,
      retainMap: false,
    });
  });
  it("reverses from the current position and cancels direct seeks/reduced/hidden", () => {
    const forward = retargetSpaceSlide(
      initialSpaceSlide("map"),
      "analytics",
      0,
      true,
    );
    const reversed = retargetSpaceSlide(forward, "map", 250, true);
    expect(spaceSlideAt(reversed, 250).mix).toBeCloseTo(
      spaceSlideAt(forward, 250).mix,
    );
    expect(spaceSlideAt(reversed, 750)).toMatchObject({
      mix: 0,
      active: false,
      retainMap: true,
    });
    expect(
      spaceSlideAt(retargetSpaceSlide(forward, null, 200, true), 200),
    ).toMatchObject({ active: false, retainMap: false });
    expect(
      spaceSlideAt(retargetSpaceSlide(forward, "analytics", 200, false), 200),
    ).toMatchObject({ mix: 1, active: false, retainMap: false });
  });
  it("wraps receiver-sensitive native browser scheduling methods", () => {
    let requested = 0,
      cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", function (this: unknown) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      requested++;
      return 7;
    });
    vi.stubGlobal("cancelAnimationFrame", function (this: unknown) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      cancelled++;
    });
    try {
      const state = retargetSpaceSlide(
        initialSpaceSlide("map"),
        "analytics",
        performance.now(),
        true,
      );
      const stop = runSpaceSlide(state, () => {}, browserSlideScheduler());
      expect(requested).toBe(1);
      stop();
      expect(cancelled).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("stops scheduling at finish and cancels queued/late callbacks on cleanup", () => {
    const callbacks = new Map<number, (time: number) => void>();
    let id = 0;
    const frames: number[] = [];
    const scheduler = {
      now: () => 0,
      request: (callback: (time: number) => void) => {
        callbacks.set(++id, callback);
        return id;
      },
      cancel: (key: number) => {
        callbacks.delete(key);
      },
    };
    const state = retargetSpaceSlide(
      initialSpaceSlide("map"),
      "analytics",
      0,
      true,
    );
    const stop = runSpaceSlide(
      state,
      (value) => frames.push(value.mix),
      scheduler,
    );
    expect(callbacks.size).toBe(1);
    const first = callbacks.get(1)!;
    callbacks.delete(1);
    first(500);
    expect(callbacks.size).toBe(0);
    expect(frames.at(-1)).toBe(1);
    stop();
    const stopEarly = runSpaceSlide(
      state,
      (value) => frames.push(value.mix),
      scheduler,
    );
    const late = [...callbacks.values()][0];
    const count = frames.length;
    stopEarly();
    late(200);
    expect(callbacks.size).toBe(0);
    expect(frames).toHaveLength(count);
  });
});

describe("scripted prompt exchanges", () => {
  const prompt = "Is the higher rent worth it?";
  const replies = [
    "One counter limits completed orders.",
    "Compare the included costs.",
  ];
  it("composes before send, presses send before moving to a user bubble, then reveals separate reply paragraphs", () => {
    const schedule = chatSchedule(prompt, replies);
    const composing = chatAt(prompt, replies, 500);
    expect(composing.promptText.length).toBeGreaterThan(0);
    expect(composing.sent).toBe(false);
    expect(composing.replyVisible).toBe(false);
    expect(chatAt(prompt, replies, schedule.sendAt + 50).sendPressed).toBe(
      true,
    );
    expect(chatAt(prompt, replies, schedule.sentAt).sent).toBe(true);
    expect(chatAt(prompt, replies, schedule.replyAt - 1).replyVisible).toBe(
      false,
    );
    expect(chatAt(prompt, replies, schedule.duration).paragraphs).toEqual(
      replies,
    );
    expect(chatAt(prompt, replies, schedule.duration).complete).toBe(true);
  });
  it("replays deterministically and offers completed distinct-speaker content in reduced motion", () => {
    const done = chatAt(prompt, replies, 0, true);
    expect(done).toMatchObject({
      sent: true,
      replyVisible: true,
      complete: true,
      paragraphs: replies,
    });
    expect(chatAt(prompt, replies, -100).promptText).toBe("");
    expect(chatAt(prompt, replies, 0).sent).toBe(false);
    expect(chatAt(prompt, replies, 700)).toEqual(chatAt(prompt, replies, 700));
  });
});
