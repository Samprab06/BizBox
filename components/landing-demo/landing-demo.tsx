"use client";
import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cameraAt, type MacbookFrame } from "./camera";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { LandingDemoData } from "./demo-data";
import {
  chapterAt,
  CHAPTER_TARGETS,
  experimentChoiceAt,
  onboardingAt,
  onboardingCanPlay,
  ONBOARDING_MS,
  type DemoChapter,
  type ExperimentChoice,
} from "./timeline";
import { Glass, Icon, Refraction, WordHeading, glassBlur } from "./demo-ui";
import { OnboardingScene } from "./onboarding";
import { Workspace } from "./workspace";
import styles from "./landing-demo.module.css";
const entryHref = "/projects/houston-coffee/intake";
export function LandingDemo({
  demo,
  macbook,
}: {
  demo: LandingDemoData;
  macbook: MacbookFrame;
}) {
  const [progress, setProgress] = useState(0);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [flowPaused, setFlowPaused] = useState(false);
  const [manualChoice, setManualChoice] = useState<ExperimentChoice | null>(
    null,
  );
  const [area, setArea] = useState<"montrose" | "heights">("montrose");
  const [failedFrame, setFailedFrame] = useState(false);
  const frame = chapterAt(progress, reduced);
  const choice = experimentChoiceAt(progress, manualChoice);
  const onboarding = onboardingAt(elapsed, reduced && frame.onboardingReady);
  const canPlay = onboardingCanPlay(progress, elapsed, {
    paused,
    visible,
    reducedMotion: reduced,
  });
  const [entrySettled, setEntrySettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setEntrySettled(frame.onboardingReady),
      frame.onboardingReady ? 500 : 0,
    );
    return () => clearTimeout(timer);
  }, [frame.onboardingReady]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let pending = false;
    let requestId = 0;
    function update() {
      pending = false;
      setProgress(
        window.scrollY /
          Math.max(1, document.documentElement.scrollHeight - innerHeight),
      );
      setViewport((previous) =>
        previous.width === innerWidth && previous.height === innerHeight
          ? previous
          : { width: innerWidth, height: innerHeight },
      );
    }
    function request() {
      if (!pending) {
        pending = true;
        requestId = requestAnimationFrame(update);
      }
    }
    const motion = () => setReduced(media.matches);
    const visibility = () => setVisible(!document.hidden);
    motion();
    visibility();
    update();
    addEventListener("scroll", request, { passive: true });
    addEventListener("resize", request, { passive: true });
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(requestId);
      removeEventListener("scroll", request);
      removeEventListener("resize", request);
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!canPlay || !entrySettled) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed((value) => Math.min(ONBOARDING_MS, value + delta));
    }, 80);
    return () => clearInterval(timer);
  }, [canPlay, entrySettled]);

  const goTo = useCallback(
    (chapter: DemoChapter) => {
      window.scrollTo({
        top:
          CHAPTER_TARGETS[chapter] *
          (document.documentElement.scrollHeight - innerHeight),
        behavior: reduced ? "auto" : "smooth",
      });
    },
    [reduced],
  );

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button,a,input,textarea,select,summary,[contenteditable=true]",
        )
      )
        return;
      const targets = [0, 0.25, 0.4, 0.52, 0.63, 0.73, 1];
      let target: number | undefined;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = 1;
      if (event.key === "PageDown")
        target = targets.find((value) => value > progress + 0.01) ?? 1;
      if (event.key === "PageUp")
        target =
          [...targets].reverse().find((value) => value < progress - 0.01) ?? 0;
      if (target === undefined) return;
      event.preventDefault();
      window.scrollTo({
        top: target * (document.documentElement.scrollHeight - innerHeight),
        behavior: reduced ? "auto" : "smooth",
      });
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [progress, reduced]);

  const camera = cameraAt(viewport, macbook, frame.entry);
  const { initial, hardware: hardwareStyle, screen: rect, card } = camera;
  const screenStyle: CSSProperties = {
    ...rect,
    borderRadius: camera.borderRadius,
    clipPath: `polygon(0 0,45% 0,45.5% ${camera.notchDepth}%,54.5% ${camera.notchDepth}%,55% 0,100% 0,100% 100%,0 100%)`,
  };
  const onboardingStyle = {
    left: card.left - rect.left,
    top: card.top - rect.top,
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
  const replayOnboarding = () => {
    setElapsed(0);
    setPaused(false);
    goTo("onboarding");
  };
  const chooseProperty = () => {
    setArea("montrose");
    goTo("property");
  };
  return (
    <div
      className={styles.root}
      data-chapter={frame.chapter}
      data-entry={frame.entry}
      data-onboarding-step={onboarding.step}
      data-onboarding-ms={Math.round(elapsed)}
      data-setup={choice}
    >
      <Refraction />
      <div className={styles.world} aria-hidden="true" />
      <Glass className={styles.navbar}>
        <button
          className={styles.brand}
          type="button"
          onClick={() => goTo("hero")}
          aria-label="BizBox home"
        >
          <BrandLogo onDark priority className={styles.brandLogo} />
        </button>
        <nav className={styles.navLinks} aria-label="Demo navigation">
          <button type="button" onClick={() => goTo("onboarding")}>
            How it works
          </button>
          <button type="button" onClick={() => goTo("location")}>
            Locations
          </button>
          <button type="button" onClick={() => goTo("experiment")}>
            Test a decision
          </button>
        </nav>
      </Glass>
      <div
        className={styles.heroCopy}
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
        <Image
          className={styles.macbook}
          style={hardwareStyle}
          src={macbook.image}
          width={macbook.width}
          height={macbook.height}
          sizes="(max-width:700px) 140vw,1000px"
          priority
          alt="Illustrative MacBook displaying BizBox onboarding"
          onError={() => setFailedFrame(true)}
        />
      )}
      <div
        className={styles.screen}
        style={screenStyle}
        data-screen-scene={frame.scene}
        data-device-view={frame.entry < 0.72 ? "laptop" : "fullscreen"}
      >
        <div className={styles.screenBase} />
        {frame.scene === "onboarding" && (
          <OnboardingScene
            ready={frame.onboardingReady}
            style={onboardingStyle}
            demo={demo}
            step={onboarding.step}
            done={onboarding.done}
            progress={onboarding.progress}
            paused={paused}
            onPause={() => setPaused((v) => !v)}
            onReplay={replayOnboarding}
            onSkip={() => setElapsed(ONBOARDING_MS)}
            onContinue={() => goTo("location")}
          />
        )}
        {frame.scene !== "onboarding" && (
          <Workspace
            demo={demo}
            frame={frame}
            choice={choice}
            reduced={reduced}
            area={area}
            mini={frame.entry < 0.72}
            running={
              frame.chapter === "experiment" &&
              visible &&
              !flowPaused &&
              !reduced
            }
            flowPaused={flowPaused}
            onArea={() => setArea("heights")}
            onProperty={chooseProperty}
            onInterior={() => goTo("interior")}
            onExperiment={() => goTo("experiment")}
            onChoice={setManualChoice}
            onFlow={() => setFlowPaused((v) => !v)}
            onReplay={() => {
              setManualChoice(null);
              setFlowPaused(false);
              goTo("experiment");
            }}
          />
        )}
      </div>
      {failedFrame && frame.entry < 0.1 && (
        <div
          className={styles.frameFallback}
          style={{
            left: initial.left,
            top: initial.top,
            width: initial.width,
            height: initial.height,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className={styles.finishCopy}
        style={{
          opacity: frame.finalOpacity,
          visibility: frame.finalOpacity === 0 ? "hidden" : "visible",
        }}
      >
        <WordHeading text="Test your business idea." />
        <Link className={styles.primary} href={entryHref} style={glassBlur}>
          Open BizBox
          <Icon name="arrow" />
        </Link>
      </div>
      <noscript>
        <style>{`.${styles.journey}{height:100svh}`}</style>
        <aside className={`${styles.noScript} ${styles.glass}`}>
          <p>
            Describe your business, compare a location and test a decision.
            Enable JavaScript to play the prepared example.
          </p>
          <Link href={entryHref}>Open BizBox →</Link>
        </aside>
      </noscript>
      <main
        className={styles.journey}
        aria-label="BizBox consultant and sandbox demo"
      >
        <p className={styles.srOnly}>
          Scroll from a preconfigured business brief to a location shortlist,
          starting assumptions and a staffed-counter comparison. No information
          is submitted. Use Page Up, Page Down, Home and End to move between
          chapters.
        </p>
      </main>
      {frame.scene === "onboarding" && (
        <a
          className={styles.credits}
          href="/landing-assets/guided-demo/credits.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Credits
        </a>
      )}
    </div>
  );
}
