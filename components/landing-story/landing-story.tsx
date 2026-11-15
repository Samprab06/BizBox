"use client";
import Image from "next/image";
import Link from "next/link";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
} from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cameraAt, type MacbookFrame } from "../landing-demo/camera";
import { StoryOnboarding } from "./story-onboarding";
import { StoryBackdrop } from "./story-backdrop";
import { STORY_ASSETS } from "./asset-paths";
import {
  Glass,
  WordHeading,
  Refraction,
  Icon,
  glassBlur,
} from "../landing-demo/demo-ui";
import type { LandingDemoData } from "../landing-demo/demo-data";
import type { LocationStoryData } from "./location-data";
import {
  CHAPTERS,
  storyAt,
  initialSpaceSlide,
  browserSlideScheduler,
  spaceSlideAt,
  retargetSpaceSlide,
  runSpaceSlide,
  type LocationSpace,
  chapterTarget,
  scrollOffset,
  activeTime,
  chatSchedule,
  holdSpaceSlide,
  ONBOARDING_MS,
  type StoryChapter,
} from "./timeline";
import { StoryMap } from "./story-map";
import {
  MorningScene,
  LocationAnalytics,
  ConsultantScene,
  LocationQuestion,
  LOCATION_PROMPT,
  LOCATION_REPLY,
  COUNTER_PROMPT,
  counterReply,
  CounterComparison,
  CounterQuestion,
} from "./story-scenes";
import base from "../landing-demo/landing-demo.module.css";
import styles from "./landing-story.module.css";
const entryHref = "/start";
const timedLimits: Partial<Record<StoryChapter, number>> = {
  question: chatSchedule(LOCATION_PROMPT, LOCATION_REPLY).duration,
  locations: 1600,
  morning: 6000,
};
export function LandingStory({
  data,
  demo,
  macbook,
}: {
  data: LocationStoryData;
  demo: LandingDemoData;
  macbook: MacbookFrame;
}) {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const resizeProgress = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [settled, setSettled] = useState(false);
  const [failedFrame, setFailedFrame] = useState(false);
  const [counterRevision, setCounterRevision] = useState(0);
  const [selected, setSelected] = useState<string>(data.selectedId);
  const [choice, setChoice] = useState<"current" | "proposed">("proposed");
  const frame = storyAt(progress, reduced);
  const [clock, setClock] = useState({ chapter: frame.chapter, ms: 0 });
  if (clock.chapter !== frame.chapter)
    setClock({ chapter: frame.chapter, ms: 0 });
  const chapterMs = clock.chapter === frame.chapter ? clock.ms : 0;
  const desiredSpace: LocationSpace = frame.outdoors
    ? "map"
    : frame.chapter === "analytics"
      ? "analytics"
      : frame.chapter === "question"
        ? "question"
        : null;
  const spaceModel = useRef(initialSpaceSlide(null));
  const [spaceFrame, setSpaceFrame] = useState(() =>
    spaceSlideAt(initialSpaceSlide(null), 0),
  );
  useEffect(() => {
    const now = performance.now();
    const previousScene = spaceModel.current.scene;
    const next = retargetSpaceSlide(
      spaceModel.current,
      desiredSpace,
      now,
      visible && !reduced,
    );
    spaceModel.current =
      paused && visible && !reduced
        ? previousScene === desiredSpace
          ? holdSpaceSlide(next, now)
          : initialSpaceSlide(desiredSpace)
        : next;
    return runSpaceSlide(
      spaceModel.current,
      setSpaceFrame,
      browserSlideScheduler(),
    );
  }, [desiredSpace, visible, reduced, paused]);
  const [heldQuestionMs, setHeldQuestionMs] = useState(0);
  if (frame.chapter === "question" && heldQuestionMs !== chapterMs)
    setHeldQuestionMs(chapterMs);
  const outdoorMinute =
    frame.chapter === "morning"
      ? reduced
        ? 720
        : 480 + Math.min(240, Math.floor(chapterMs / 125) * 5)
      : 480;
  const outdoorNow = {
    kind:
      frame.chapter === "morning"
        ? ("morning" as const)
        : ("locations" as const),
    minute: outdoorMinute,
    expanded: reduced || frame.chapter === "morning" || chapterMs >= 350,
  };
  const [heldOutdoor, setHeldOutdoor] = useState(outdoorNow);
  if (
    frame.outdoors &&
    (heldOutdoor.kind !== outdoorNow.kind ||
      heldOutdoor.minute !== outdoorNow.minute ||
      heldOutdoor.expanded !== outdoorNow.expanded)
  )
    setHeldOutdoor(outdoorNow);
  const outdoor = frame.outdoors ? outdoorNow : heldOutdoor;
  const paneMix =
    spaceFrame.scene === null
      ? desiredSpace === "question"
        ? -1
        : Number(desiredSpace === "analytics")
      : spaceFrame.mix;
  const showMap =
    visible &&
    desiredSpace !== null &&
    (desiredSpace === "map" || spaceFrame.retainMap);
  const showQuestion =
    desiredSpace === "question" ||
    (desiredSpace !== null && spaceFrame.retainQuestion);
  const showAnalytics =
    desiredSpace === "analytics" ||
    (desiredSpace !== null && spaceFrame.retainAnalytics);
  const timedLimit =
    frame.chapter === "consultant"
      ? chatSchedule(data.consultant.question, data.consultant.messages)
          .duration
      : frame.chapter === "counter-question"
        ? chatSchedule(COUNTER_PROMPT, counterReply(demo)).duration
        : (timedLimits[frame.chapter] ?? 0);
  const needsOnboarding =
    frame.onboardingReady && settled && elapsed < ONBOARDING_MS;
  const needsChapterTime = chapterMs < timedLimit;
  useEffect(() => {
    const timer = setTimeout(
      () => setSettled(frame.onboardingReady),
      frame.onboardingReady ? 500 : 0,
    );
    return () => clearTimeout(timer);
  }, [frame.onboardingReady]);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const update = () => {
      raf = 0;
      const range = Math.max(
        1,
        document.documentElement.scrollHeight - innerHeight,
      );
      if (resizeProgress.current !== null) {
        const preserved = resizeProgress.current;
        resizeProgress.current = null;
        window.scrollTo({
          top: scrollOffset(
            preserved,
            document.documentElement.scrollHeight,
            innerHeight,
          ),
          behavior: "instant",
        });
      }
      progressRef.current = scrollY / range;
      setProgress(progressRef.current);
      setViewport((prev) =>
        prev.width === innerWidth && prev.height === innerHeight
          ? prev
          : { width: innerWidth, height: innerHeight },
      );
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const resize = () => {
      resizeProgress.current ??= progressRef.current;
      request();
    };
    // A new gesture or explicit seek takes priority over a pending resize.
    const input = () => {
      resizeProgress.current = null;
    };
    const change = () => setReduced(motion.matches);
    const visibility = () => setVisible(!document.hidden);
    update();
    change();
    visibility();
    addEventListener("scroll", request, { passive: true });
    addEventListener("resize", resize, { passive: true });
    addEventListener("wheel", input, { passive: true });
    addEventListener("touchmove", input, { passive: true });
    addEventListener("pointerdown", input, { passive: true });
    motion.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", request);
      removeEventListener("resize", resize);
      removeEventListener("wheel", input);
      removeEventListener("touchmove", input);
      removeEventListener("pointerdown", input);
      motion.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (
      !visible ||
      paused ||
      reduced ||
      (!needsOnboarding && !needsChapterTime)
    )
      return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      if (needsOnboarding)
        setElapsed((value) =>
          activeTime(
            value,
            delta,
            { active: true, visible, paused, reduced },
            ONBOARDING_MS,
          ),
        );
      if (needsChapterTime)
        setClock((value) => ({
          ...value,
          ms: activeTime(
            value.ms,
            delta,
            { active: true, visible, paused, reduced },
            timedLimit,
          ),
        }));
    }, 40);
    return () => clearInterval(timer);
  }, [
    visible,
    paused,
    reduced,
    needsOnboarding,
    needsChapterTime,
    timedLimit,
    frame.chapter,
  ]);
  const seek = useCallback(
    (p: number) => {
      resizeProgress.current = null;
      window.scrollTo({
        top: scrollOffset(
          p,
          document.documentElement.scrollHeight,
          innerHeight,
        ),
        behavior: reduced ? "auto" : "smooth",
      });
    },
    [reduced],
  );
  const go = useCallback(
    (chapter: StoryChapter) => {
      seek(chapterTarget(chapter));
    },
    [seek],
  );
  const next = () =>
    go(CHAPTERS[Math.min(frame.index + 1, CHAPTERS.length - 1)].id);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "a,button,input,summary,textarea,select,[contenteditable=true]",
          ))
      )
        return;
      let target: number | undefined;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = 1;
      if (event.key === "PageDown")
        target = chapterTarget(
          CHAPTERS[Math.min(frame.index + 1, CHAPTERS.length - 1)].id,
        );
      if (event.key === "PageUp")
        target = chapterTarget(CHAPTERS[Math.max(0, frame.index - 1)].id);
      if (target !== undefined) {
        event.preventDefault();
        seek(target + 0.00001);
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [frame.index, seek]);
  const camera = cameraAt(viewport, macbook, frame.entry, {
    heroScale: viewport.width > 700 && viewport.height > 480 ? 0.86 : 1,
    heroCenterY: 0.65,
  });
  const { card, screen } = camera;
  // The backdrop initially occupies only the laptop aperture. The browser keeps
  // that decoded candidate visible while upgrading as the screen expands.
  const stageSizes = `${Math.ceil(Math.max(screen.width, (screen.height * STORY_ASSETS.stage.width) / STORY_ASSETS.stage.height))}px`;
  const onboardingStyle = {
    left: card.left - screen.left,
    top: card.top - screen.top,
    width: card.width,
    height: card.height,
    "--card-padding": `${card.padding}px`,
    "--question-size": `${card.questionSize}px`,
    "--question-gap": `${card.questionGap}px`,
    "--brand-height": `${card.brandHeight}px`,
    "--brand-gap": `${card.brandGap}px`,
    "--category-height": `${card.categoryHeight}px`,
    "--category-size": `${card.categorySize}px`,
    "--category-padding": `${card.categoryPadding}px`,
    "--category-gap": `${card.categoryGap}px`,
    "--tile-gap": `${card.tileGap}px`,
    "--category-icon": `${card.iconSize}px`,
    "--controls-height": `${card.controlsHeight}px`,
    "--controls-gap": `${card.controlsGap}px`,
  } as CSSProperties;
  const replay = () => {
    setPaused(false);
    if (frame.chapter === "counters") setCounterRevision((value) => value + 1);
    if (frame.chapter === "onboarding") {
      setElapsed(0);
    } else {
      setClock({ chapter: frame.chapter, ms: 0 });
    }
  };
  const selectSite = useCallback((id: string) => setSelected(id), []);
  const onInterior =
    frame.chapter === "interior" || frame.chapter === "counter-question";
  const sendQuestion = (prompt: string, replies: readonly string[]) =>
    setClock({
      chapter: frame.chapter,
      ms: Math.max(chapterMs, chatSchedule(prompt, replies).sentAt),
    });
  return (
    <div
      className={`${base.root} ${styles.root}`}
      data-story-chapter={frame.chapter}
      data-entry={frame.entry}
      data-onboarding-ms={Math.round(elapsed)}
      data-space-mix={paneMix}
      data-space-active={spaceFrame.active}
      data-location-reveal={
        frame.chapter === "locations" && !reduced
          ? chapterMs < 350
            ? 0
            : chapterMs < 1000
              ? 1
              : 2
          : 2
      }
    >
      <Refraction />
      <StoryBackdrop variant="world" fetchPriority="auto" />
      <Glass className={`${base.navbar} ${styles.navbar}`}>
        <button
          className={base.brand}
          onClick={() => go("hero")}
          type="button"
          aria-label="BizBox home"
        >
          <BrandLogo onDark priority className={base.brandLogo} />
        </button>
        <nav className={base.navLinks} aria-label="Story navigation">
          <button onClick={() => go("onboarding")} type="button">
            How it works
          </button>
          <button onClick={() => go("locations")} type="button">
            Locations
          </button>
          <button onClick={() => go("counters")} type="button">
            Test a decision
          </button>
        </nav>
      </Glass>
      <div
        className={`${base.heroCopy} ${styles.heroCopy}`}
        style={{
          opacity: frame.heroOpacity,
          visibility: frame.heroOpacity === 0 ? "hidden" : "visible",
        }}
      >
        <WordHeading
          as="h1"
          text="Test your business"
          lineTwo="before you commit."
        />
      </div>
      {!failedFrame && (
        <picture>
          <source
            type="image/webp"
            srcSet={STORY_ASSETS.macbook.imageSrcSet}
            sizes={STORY_ASSETS.macbook.sizes}
          />
          <Image
            className={base.macbook}
            src={macbook.image}
            style={camera.hardware}
            width={macbook.width}
            height={macbook.height}
            unoptimized
            loading="eager"
            fetchPriority="high"
            alt="MacBook displaying BizBox"
            onError={() => setFailedFrame(true)}
          />
        </picture>
      )}
      <div
        className={`${base.screen} ${styles.screen}`}
        style={{
          ...screen,
          borderRadius: camera.borderRadius,
          clipPath: `polygon(0 0,45% 0,45.5% ${camera.notchDepth}%,54.5% ${camera.notchDepth}%,55% 0,100% 0,100% 100%,0 100%)`,
        }}
        data-device-view={frame.entry < 0.72 ? "laptop" : "fullscreen"}
        data-screen-scene={frame.chapter}
      >
        <StoryBackdrop
          variant="stage"
          sizes={stageSizes}
          priority
          fetchPriority="low"
        />
        {(frame.chapter === "hero" || frame.chapter === "onboarding") && (
          <StoryOnboarding
            ready={frame.onboardingReady}
            style={onboardingStyle}
            demo={demo}
            elapsed={elapsed}
            reduced={reduced}
            paused={paused}
            onPause={() => setPaused((v) => !v)}
            onReplay={() => {
              setElapsed(0);
              setPaused(false);
              go("onboarding");
            }}
            onSkip={() => setElapsed(ONBOARDING_MS)}
            onContinue={() => go("question")}
          />
        )}
        {showQuestion && (
          <div
            className={styles.spacePane}
            data-space-pane="question"
            style={{
              transform: `translate3d(${-(paneMix + 1) * 100}%,0,0)`,
              willChange: spaceFrame.active ? "transform" : "auto",
            }}
            inert={desiredSpace !== "question"}
          >
            <StoryBackdrop variant="stage" />
            <LocationQuestion
              elapsed={
                frame.chapter === "question" ? chapterMs : heldQuestionMs
              }
              reduced={reduced}
              onSend={() => sendQuestion(LOCATION_PROMPT, LOCATION_REPLY)}
            />
          </div>
        )}
        {showMap && (
          <div
            className={styles.spacePane}
            data-space-pane="map"
            style={{
              transform: `translate3d(${-paneMix * 100}%,0,0)`,
              willChange: spaceFrame.active ? "transform" : "auto",
            }}
            inert={desiredSpace !== "map"}
          >
            <StoryMap
              data={data}
              minute={outdoor.minute}
              viewport={viewport}
              morning={outdoor.kind === "morning"}
              expanded={outdoor.expanded}
              selected={selected}
              onSelect={selectSite}
            />
            {outdoor.kind === "locations" && (
              <>
                <div className={styles.sceneTitle}>
                  <WordHeading text="Two spaces for your café." />
                </div>
                <p className={styles.mapNote}>
                  Example neighborhoods · rent and size are assumed, not
                  verified listings
                </p>
              </>
            )}
            {outdoor.kind === "morning" && (
              <MorningScene
                data={data}
                elapsed={(outdoor.minute - 480) * 25}
                reduced={reduced}
              />
            )}
          </div>
        )}
        {showAnalytics && (
          <div
            className={`${styles.spacePane} ${styles.analyticsPane}`}
            data-space-pane="analytics"
            style={{
              transform: `translate3d(${(1 - paneMix) * 100}%,0,0)`,
              willChange: spaceFrame.active ? "transform" : "auto",
            }}
            inert={desiredSpace !== "analytics"}
          >
            <StoryBackdrop variant="stage" />
            <LocationAnalytics data={data} />
          </div>
        )}
        {(frame.chapter === "consultant" || onInterior) && (
          <ConsultantScene
            data={data}
            elapsed={
              frame.chapter === "consultant"
                ? chapterMs
                : chatSchedule(
                    data.consultant.question,
                    data.consultant.messages,
                  ).duration
            }
            reduced={reduced}
            onSend={() =>
              sendQuestion(data.consultant.question, data.consultant.messages)
            }
            interiorMix={
              frame.chapter === "counter-question"
                ? 1
                : frame.chapter === "interior"
                  ? frame.interiorMix
                  : 0
            }
            cursorMix={frame.chapter === "interior" ? frame.cursorMix : 0}
            pan={frame.interiorPan}
            onEnter={() => seek(0.742)}
          />
        )}
        {frame.chapter === "counter-question" && (
          <CounterQuestion
            demo={demo}
            elapsed={chapterMs}
            reduced={reduced}
            onSend={() => sendQuestion(COUNTER_PROMPT, counterReply(demo))}
          />
        )}
        {(frame.chapter === "counters" || frame.chapter === "return") && (
          <CounterComparison
            demo={demo}
            choice={choice}
            replayRevision={counterRevision}
            onChoice={setChoice}
            running={
              frame.chapter === "counters" && visible && !paused && !reduced
            }
            mini={frame.chapter === "return"}
          />
        )}
        {frame.chapter !== "hero" &&
          frame.chapter !== "onboarding" &&
          frame.chapter !== "return" && (
            <Glass className={styles.playback}>
              <button
                onClick={() => setPaused((v) => !v)}
                type="button"
                aria-label={paused ? "Resume story" : "Pause story"}
              >
                <Icon name={paused ? "play" : "pause"} />
              </button>
              <button
                type="button"
                onClick={replay}
                aria-label="Replay this scene"
              >
                <Icon name="replay" />
              </button>
              <button onClick={next} type="button">
                Continue <Icon name="arrow" />
              </button>
            </Glass>
          )}
      </div>
      <div
        className={`${base.finishCopy} ${styles.finishCopy}`}
        style={{
          opacity: frame.finalOpacity,
          visibility: frame.finalOpacity === 0 ? "hidden" : "visible",
        }}
      >
        <WordHeading text="Test your business idea." />
        <Link
          className={base.primary}
          href={entryHref}
          prefetch={false}
          style={glassBlur}
        >
          Open BizBox <Icon name="arrow" />
        </Link>
      </div>
      <a
        className={base.credits}
        href="/landing-assets/guided-demo/credits.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Credits
      </a>
      <main
        className={styles.journey}
        aria-label="BizBox location and counter decisions"
      >
        <p className={styles.srOnly}>
          Scroll through an example business brief, two Houston neighborhoods,
          modeled results, consultant recommendation and one-versus-two-counter
          comparison. Page Up and Page Down move between scenes. Home returns to
          the hero and End shows the chosen result.
        </p>
      </main>
      <noscript>
        <aside className={base.noScript}>
          <p>
            BizBox helps compare business decisions. Enable JavaScript to play
            the prepared story.
          </p>
          <Link href={entryHref} prefetch={false}>
            Open BizBox
          </Link>
        </aside>
      </noscript>
    </div>
  );
}
