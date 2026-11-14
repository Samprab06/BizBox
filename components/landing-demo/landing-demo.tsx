"use client";

import Link from "next/link";
import Image from "next/image";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { LandingDemoData } from "./demo-data";
import {
  chapterAt,
  CHAPTER_TARGETS,
  experimentChoiceAt,
  onboardingAt,
  ONBOARDING_MS,
  smooth,
  type DemoChapter,
  type ExperimentChoice,
  type OnboardingStep,
} from "./timeline";
import styles from "./landing-demo.module.css";

type MacbookFrame = {
  image: string;
  width: number;
  height: number;
  screenQuad: { x: number; y: number }[];
};
type Frame = ReturnType<typeof chapterAt>;
const entryHref = "/projects/houston-coffee/intake";
const assets = "/landing-assets/guided-demo/";
const glassBlur: CSSProperties = {
  backdropFilter: "blur(14px) saturate(1.25)",
  WebkitBackdropFilter: "blur(14px) saturate(1.25)",
};
const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

function Icon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    replay: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    cup: (
      <>
        <path d="M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM16 10h2a3 3 0 0 1 0 6h-2M7 3v2M12 3v2" />
      </>
    ),
    food: (
      <>
        <path d="M5 3v7M8 3v7M11 3v7M5 7h6M8 10v11M18 3v18M18 3c-5 4-5 10 0 10" />
      </>
    ),
    salon: (
      <>
        <circle cx="6" cy="17" r="3" />
        <circle cx="17" cy="17" r="3" />
        <path d="m8 15 11-12M15 15 4 3" />
      </>
    ),
    fitness: (
      <>
        <path d="M8 12h8M3 8v8M7 6v12M17 6v12M21 8v8" />
      </>
    ),
    sparkle: (
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
    ),
    pin: (
      <>
        <path d="M18 10c0 5-6 10-6 10S6 15 6 10a6 6 0 1 1 12 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}

function Glass({
  children,
  className = "",
  style,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      style={{ ...glassBlur, ...style }}
      className={`${styles.glass} ${className}`}
    >
      {children}
    </div>
  );
}

function Refraction() {
  return (
    <svg className={styles.filter} aria-hidden="true">
      <defs>
        <filter
          id="bizbox-demo-refraction"
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.013 0.028"
            numOctaves="1"
            seed="7"
            result="normal"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="normal"
            scale="9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

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
  const onboarding = onboardingAt(
    frame.chapter === "hero" ? 0 : elapsed,
    reduced,
  );
  const playing =
    frame.chapter === "onboarding" &&
    progress >= 0.2 &&
    !paused &&
    !reduced &&
    visible &&
    elapsed < ONBOARDING_MS;

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
    if (!playing) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed((value) => Math.min(ONBOARDING_MS, value + delta));
    }, 80);
    return () => clearInterval(timer);
  }, [playing]);

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

  const width = Math.min(
    viewport.width * 1.37,
    1000,
    viewport.height * 0.6 * (macbook.width / macbook.height),
  );
  const height = (width * macbook.height) / macbook.width;
  const left = (viewport.width - width) / 2;
  const top = viewport.height * 0.61 - height / 2;
  const q = macbook.screenQuad;
  const initial = {
    left: left + q[0].x * width,
    top: top + q[0].y * height,
    width: (q[1].x - q[0].x) * width,
    height: (q[3].y - q[0].y) * height,
  };
  // Uniform camera-like zoom preserves laptop proportions. Once hardware has
  // faded, the DOM screen can fit the exact responsive viewport on its own.
  const zoomMix = smooth(0, 0.78, frame.entry);
  const coverScale = Math.max(
    viewport.width / initial.width,
    viewport.height / initial.height,
  );
  const zoom = 1 + (coverScale - 1) * zoomMix;
  const centerX =
    (initial.left + initial.width / 2) * (1 - zoomMix) +
    (viewport.width / 2) * zoomMix;
  const centerY =
    (initial.top + initial.height / 2) * (1 - zoomMix) +
    (viewport.height / 2) * zoomMix;
  const uniform = {
    left: centerX - (initial.width * zoom) / 2,
    top: centerY - (initial.height * zoom) / 2,
    width: initial.width * zoom,
    height: initial.height * zoom,
  };
  const fit = smooth(0.78, 1, frame.entry);
  const rect = {
    left: uniform.left * (1 - fit),
    top: uniform.top * (1 - fit),
    width: uniform.width + (viewport.width - uniform.width) * fit,
    height: uniform.height + (viewport.height - uniform.height) * fit,
  };
  const renderedWidth = width * zoom;
  const renderedHeight = height * zoom;
  const hardwareStyle: CSSProperties = {
    width: renderedWidth,
    height: renderedHeight,
    left: uniform.left - q[0].x * renderedWidth,
    top: uniform.top - q[0].y * renderedHeight,
    opacity: 1 - smooth(0.38, 0.68, frame.entry),
  };
  const screenStyle: CSSProperties = {
    ...rect,
    clipPath: `polygon(0 0,44.5% 0,45% ${(1 - frame.entry) * 2.9}%,55% ${(1 - frame.entry) * 2.9}%,55.5% 0,100% 0,100% 100%,0 100%)`,
  };
  const activeArea = frame.chapter === "location" ? area : "montrose";
  const showProperty = frame.chapter === "property";
  const showSpatial = [
    "location",
    "property",
    "interior",
    "experiment",
    "return",
    "finish",
  ].includes(frame.chapter);
  const setup = demo.experiment[choice];
  const replayOnboarding = () => {
    setElapsed(0);
    setPaused(false);
    goTo("onboarding");
  };
  const showChosenProperty = () => {
    setArea("montrose");
    goTo("property");
  };

  return (
    <div
      className={styles.root}
      data-chapter={frame.chapter}
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
          <span className={styles.brandMark}>
            <Icon name="sparkle" />
          </span>
          BizBox<span className={styles.brandDot}>.</span>
        </button>
        <nav aria-label="Main navigation" className={styles.navLinks}>
          <button type="button" onClick={() => goTo("onboarding")}>
            The demo
          </button>
          <button type="button" onClick={() => goTo("experiment")}>
            The decision
          </button>
        </nav>
        <Link className={styles.navCta} href={entryHref}>
          Open BizBox <Icon name="arrow" />
        </Link>
      </Glass>

      <div
        className={styles.heroCopy}
        style={{
          opacity: frame.heroOpacity,
          visibility: frame.heroOpacity === 0 ? "hidden" : "visible",
        }}
      >
        <h1>
          Test your business
          <br />
          <span>before you commit.</span>
        </h1>
      </div>

      <div
        className={styles.screen}
        style={screenStyle}
        data-screen-scene={frame.scene}
        data-device-view={frame.entry < 0.72 ? "laptop" : "fullscreen"}
      >
        <div className={styles.screenBase} />
        <SceneImage
          file="map-v1.png"
          alt="Illustrative oblique map of Houston"
          opacity={frame.mapOpacity}
        />
        <SceneImage
          file="cafe-interior-v1.png"
          alt="Illustrative green-tile and walnut café interior"
          opacity={frame.interiorOpacity}
          zoom={reduced ? 1 : 1 + smooth(0.58, 0.69, progress) * 0.035}
        />
        <SceneImage
          file="cafe-overhead-v1.png"
          alt="Illustrative overhead view of the same café"
          opacity={frame.overheadOpacity}
        />
        <div className={styles.sceneShade} />

        {frame.scene === "onboarding" && (
          <>
            {frame.entry > 0.8 && (
              <div className={styles.chapterHeading}>
                <h2>Understand your business</h2>
              </div>
            )}
            <Onboarding
              demo={demo}
              step={onboarding.step}
              done={onboarding.done}
              progress={onboarding.progress}
              paused={paused}
              onPause={() => setPaused((value) => !value)}
              onReplay={replayOnboarding}
              onSkip={() => setElapsed(ONBOARDING_MS)}
              onContinue={() => goTo("location")}
            />
          </>
        )}

        {showSpatial && (
          <>
            <div className={styles.chapterHeading}>
              <h2>
                {frame.scene === "location"
                  ? showProperty
                    ? "A space for your idea."
                    : "Find a location."
                  : frame.scene === "interior"
                    ? "Explore the space."
                    : "Test the decision."}
              </h2>
            </div>
            {frame.scene === "location" && (
              <>
                <button
                  className={`${styles.mapPin} ${styles.montrosePin}`}
                  onClick={showChosenProperty}
                  type="button"
                >
                  <Icon name="pin" />
                  <span>Montrose</span>
                </button>
                <button
                  className={`${styles.mapPin} ${styles.heightsPin}`}
                  onClick={() => setArea("heights")}
                  type="button"
                >
                  <span>The Heights</span>
                </button>
                <Glass className={styles.propertyPanel}>
                  <span className={styles.kicker}>Example space</span>
                  <h3>
                    {activeArea === "heights"
                      ? "The Heights"
                      : demo.property.name}
                  </h3>
                  <p className={styles.subtle}>
                    {activeArea === "heights"
                      ? "Another area on your shortlist"
                      : demo.property.area}
                  </p>
                  {activeArea === "montrose" && (
                    <dl className={styles.propertyFacts}>
                      <div>
                        <dt>Monthly rent</dt>
                        <dd>{dollars(demo.property.rent)}</dd>
                      </div>
                      <div>
                        <dt>Floor area</dt>
                        <dd>
                          {number(demo.property.size)} <small>sq ft</small>
                        </dd>
                      </div>
                    </dl>
                  )}
                  <button
                    className={styles.primary}
                    type="button"
                    onClick={
                      showProperty ? () => goTo("interior") : showChosenProperty
                    }
                  >
                    {showProperty
                      ? "Explore the café"
                      : activeArea === "heights"
                        ? "View Montrose example"
                        : "View the space"}
                    <Icon name="arrow" />
                  </button>
                </Glass>
              </>
            )}
            <Assistant
              demo={demo}
              frame={frame}
              choice={choice}
              area={activeArea}
              onAdd={() => setManualChoice("proposed")}
            />
            {frame.scene === "interior" && (
              <button
                className={`${styles.primary} ${styles.interiorContinue}`}
                style={glassBlur}
                onClick={() => goTo("experiment")}
                type="button"
              >
                Test the counter setup <Icon name="arrow" />
              </button>
            )}
            {frame.scene === "experiment" && (
              <>
                <CustomerFlow
                  proposed={choice === "proposed"}
                  running={
                    frame.chapter === "experiment" &&
                    visible &&
                    !flowPaused &&
                    !reduced
                  }
                />
                <Glass className={styles.resultPanel}>
                  <div
                    className={styles.setupToggle}
                    role="group"
                    aria-label="Compare staffed counter setups"
                  >
                    <button
                      type="button"
                      aria-pressed={choice === "current"}
                      onClick={() => setManualChoice("current")}
                    >
                      One counter
                    </button>
                    <button
                      type="button"
                      aria-pressed={choice === "proposed"}
                      onClick={() => setManualChoice("proposed")}
                    >
                      Two counters
                    </button>
                  </div>
                  <div className={styles.flowControls}>
                    <button
                      type="button"
                      onClick={() => setFlowPaused((value) => !value)}
                      aria-label={
                        flowPaused
                          ? "Resume illustrative customer flow"
                          : "Pause illustrative customer flow"
                      }
                    >
                      <Icon name={flowPaused ? "play" : "pause"} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setManualChoice(null);
                        setFlowPaused(false);
                        goTo("experiment");
                      }}
                      aria-label="Replay the counter comparison"
                    >
                      <Icon name="replay" />
                    </button>
                    <span>
                      Same {demo.experiment.arrivals} generated customers
                    </span>
                  </div>
                  <div className={styles.resultHeading}>
                    <span>
                      {setup.staff}{" "}
                      {setup.staff === 1 ? "staff member" : "staff members"}
                    </span>
                    <span>{demo.experiment.period}</span>
                  </div>
                  <dl className={styles.results}>
                    <div>
                      <dt>Customers served</dt>
                      <dd>{setup.served}</dd>
                    </div>
                    <div>
                      <dt>P90 wait</dt>
                      <dd>
                        {setup.p90WaitMin?.toFixed(1) ?? "—"}
                        <small> min</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Staffing cost</dt>
                      <dd>{dollars(setup.laborUsd)}</dd>
                    </div>
                  </dl>
                  <div className={styles.contribution}>
                    <span>Daily equivalent contribution</span>
                    <strong>{dollars(setup.contributionUsd)}</strong>
                  </div>
                  {choice === "proposed" && (
                    <p className={styles.costDelta}>
                      +
                      {dollars(
                        demo.experiment.proposed.laborUsd -
                          demo.experiment.current.laborUsd,
                      )}{" "}
                      morning labor · +
                      {dollars(demo.experiment.additionalBuildoutUsd)} setup
                    </p>
                  )}
                  <details className={styles.source}>
                    <summary>How this is modeled</summary>
                    <p>
                      {demo.source}. Decorative customer paths illustrate flow,
                      not individual replay events.{" "}
                      {demo.experiment.definitions.contributionUsd}{" "}
                      {demo.experiment.definitions.p90WaitMin} Added buildout:{" "}
                      {dollars(demo.experiment.additionalBuildoutUsd)}.
                    </p>
                  </details>
                </Glass>
              </>
            )}
            <span className={styles.sceneLabel}>
              Illustrative demo
              {frame.scene === "experiment"
                ? " · modeled results"
                : " · example space"}
            </span>
          </>
        )}
      </div>

      {!failedFrame && (
        <Image
          className={styles.macbook}
          style={hardwareStyle}
          src={macbook.image}
          width={macbook.width}
          height={macbook.height}
          sizes="(max-width: 700px) 140vw, 1000px"
          priority
          alt="Sourced MacBook displaying the BizBox demo"
          onError={() => setFailedFrame(true)}
        />
      )}
      {failedFrame && frame.entry < 0.1 && (
        <div
          className={`${styles.frameFallback} ${styles.glass}`}
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
        <h2>Test your business idea.</h2>
        <Link className={styles.primary} href={entryHref} style={glassBlur}>
          Open BizBox <Icon name="arrow" />
        </Link>
      </div>
      <nav
        className={`${styles.chapterNav} ${styles.glass}`}
        style={glassBlur}
        aria-label="Demo chapters"
      >
        {(
          [
            ["onboarding", "Business"],
            ["location", "Location"],
            ["interior", "Space"],
            ["experiment", "Decision"],
          ] as const
        ).map(([id, label], index) => (
          <button
            key={id}
            type="button"
            onClick={() => goTo(id)}
            aria-current={
              frame.scene ===
              (id === "experiment"
                ? "experiment"
                : id === "location"
                  ? "location"
                  : id === "interior"
                    ? "interior"
                    : "onboarding")
                ? "step"
                : undefined
            }
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {label}
          </button>
        ))}
      </nav>
      <noscript>
        <style>{`.${styles.journey}{height:100svh}.${styles.chapterNav}{display:none}`}</style>
        <aside className={`${styles.noScript} ${styles.glass}`}>
          <p>
            Describe your business, explore a location and test a decision.
            Enable JavaScript to play the guided example.
          </p>
          <Link href={entryHref}>Open BizBox →</Link>
        </aside>
      </noscript>
      <main className={styles.journey} aria-label="BizBox guided business demo">
        <p className={styles.srOnly}>
          Scroll through the preconfigured business brief, location, property,
          illustrative interior and counter comparison. Use the chapter
          navigation to jump between scenes. No information is submitted.
        </p>
      </main>
      <a
        className={styles.credits}
        href="/landing-assets/macbook/credits.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        MacBook credits
      </a>
    </div>
  );
}

function SceneImage({
  file,
  alt,
  opacity,
  zoom = 1,
}: {
  file: string;
  alt: string;
  opacity: number;
  zoom?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={styles.sceneImage}
      style={{ opacity }}
      data-artwork={file}
      aria-hidden={opacity === 0}
    >
      {!failed && (
        <Image
          src={`${assets}${file}`}
          alt={alt}
          fill
          sizes="100vw"
          onError={() => setFailed(true)}
          style={{ transform: `scale(${zoom})` }}
        />
      )}
      {failed && (
        <div className={styles.sceneFallback} role="status">
          Illustrative scene unavailable
        </div>
      )}
    </div>
  );
}

const Onboarding = memo(function Onboarding({
  demo,
  step,
  done,
  progress,
  paused,
  onPause,
  onReplay,
  onSkip,
  onContinue,
}: {
  demo: LandingDemoData;
  step: OnboardingStep;
  done: boolean;
  progress: number;
  paused: boolean;
  onPause: () => void;
  onReplay: () => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  const questions: Record<OnboardingStep, string> = {
    category: "What are you opening?",
    concept: "Describe your business.",
    city: "Where are you looking?",
    budget: "What’s your monthly rent limit?",
    staff: "How many people will be on shift?",
    review: "Your business, in focus.",
  };
  return (
    <Glass className={styles.onboardingPanel}>
      <div className={styles.questionContent} key={step}>
        <span className={styles.questionBrand}>
          BizBox<span>.</span>
        </span>
        <h3>{questions[step]}</h3>
        {step === "category" && (
          <div
            className={styles.categories}
            role="list"
            aria-label="Preconfigured business type"
          >
            {[
              ["cup", "Coffee shop"],
              ["food", "Quick food"],
              ["salon", "Salon"],
              ["fitness", "Fitness"],
            ].map(([icon, label]) => (
              <div
                key={label}
                role="listitem"
                data-selected={label === demo.business.category}
              >
                <Icon name={icon} />
                <span>{label}</span>
                {label === demo.business.category && <Icon name="check" />}
              </div>
            ))}
          </div>
        )}
        {step === "concept" && (
          <div className={styles.prefilledField}>{demo.business.concept}</div>
        )}
        {step === "city" && (
          <div className={styles.cityChoices}>
            <div data-selected="true">
              <Icon name="pin" />
              <strong>{demo.business.city}</strong>
              <Icon name="check" />
            </div>
            <div>
              <Icon name="pin" />
              <span>Los Angeles</span>
            </div>
          </div>
        )}
        {(step === "budget" || step === "staff") && (
          <div className={styles.rulerAnswer}>
            <strong>
              {step === "budget"
                ? dollars(demo.business.rentLimit)
                : demo.business.staff}
              <small>{step === "budget" ? " / month" : " on shift"}</small>
            </strong>
            <div className={styles.ruler} aria-hidden="true">
              {Array.from({ length: 25 }, (_, i) => (
                <i key={i} data-major={i % 5 === 0} />
              ))}
              <b />
            </div>
          </div>
        )}
        {step === "review" && (
          <>
            <p className={styles.reviewConcept}>{demo.business.concept}</p>
            <dl className={styles.reviewFacts}>
              <div>
                <dt>Business</dt>
                <dd>{demo.business.category}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {demo.business.area}, {demo.business.city}
                </dd>
              </div>
              <div>
                <dt>Rent limit</dt>
                <dd>{dollars(demo.business.rentLimit)} / month</dd>
              </div>
              <div>
                <dt>Buildout</dt>
                <dd>{dollars(demo.business.buildout)}</dd>
              </div>
              <div>
                <dt>Team & hours</dt>
                <dd>
                  {demo.business.staff} on shift · {demo.business.hours}
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
      <div className={styles.onboardingControls}>
        <div
          className={styles.montageProgress}
          aria-label="Preconfigured demo progress"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className={styles.montageActions}>
          {done ? (
            <button
              type="button"
              onClick={onReplay}
              aria-label="Replay the seven-second onboarding demo"
            >
              <Icon name="replay" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPause}
                aria-label={
                  paused ? "Resume onboarding demo" : "Pause onboarding demo"
                }
              >
                <Icon name={paused ? "play" : "pause"} />
              </button>
              <button type="button" onClick={onSkip}>
                Skip
              </button>
            </>
          )}
          <span>Prefilled demo</span>
          {done && (
            <button
              className={styles.smallPrimary}
              type="button"
              onClick={onContinue}
            >
              Find a location <Icon name="arrow" />
            </button>
          )}
        </div>
      </div>
    </Glass>
  );
});

function Assistant({
  demo,
  frame,
  choice,
  area,
  onAdd,
}: {
  demo: LandingDemoData;
  frame: Frame;
  choice: ExperimentChoice;
  area: string;
  onAdd: () => void;
}) {
  const gain = demo.experiment.proposed.served - demo.experiment.current.served;
  const labor =
    demo.experiment.proposed.laborUsd - demo.experiment.current.laborUsd;
  const message =
    frame.scene === "location"
      ? frame.chapter === "property"
        ? "Check the rent and size. Then take a look at the space."
        : area === "heights"
          ? "The Heights is on the shortlist, too. This walkthrough follows the Montrose example."
          : "Two example areas. Let’s start with the Montrose space."
      : frame.scene === "interior"
        ? "Here’s the service area. What happens when the morning gets busy?"
        : choice === "current"
          ? "One staffed counter. A morning queue forms. What if you opened a second?"
          : `A second staffed counter serves ${gain} more customers. It adds ${dollars(labor)} in labor for this morning.`;
  return (
    <Glass className={styles.assistant} key={frame.scene}>
      <header>
        <span className={styles.assistantIcon}>
          <Icon name="sparkle" />
        </span>
        <strong>BizBox consultant</strong>
        <span>Demo</span>
      </header>
      <p>{message}</p>
      {frame.scene === "experiment" && choice === "current" && (
        <button
          className={styles.assistantAction}
          type="button"
          onClick={onAdd}
        >
          Add a staffed counter <span>+</span>
        </button>
      )}
    </Glass>
  );
}

const CustomerFlow = memo(function CustomerFlow({
  proposed,
  running,
}: {
  proposed: boolean;
  running: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    if (running) element.unpauseAnimations?.();
    else element.pauseAnimations?.();
  }, [running]);
  const first =
    "M335 880 Q600 820 740 710 Q850 640 1040 650 L1110 700 Q800 850 350 900";
  const second =
    "M335 880 Q620 700 800 550 Q900 480 1010 485 L1070 530 Q800 800 350 900";
  return (
    <svg
      ref={svg}
      className={styles.customerFlow}
      viewBox="0 0 1586 992"
      preserveAspectRatio="xMidYMid meet"
      aria-label="Illustrative customer paths and staffed counters"
      role="img"
    >
      <path d={first} className={styles.routePath} />
      {proposed && <path d={second} className={styles.routePath} />}
      {Array.from({ length: proposed ? 8 : 5 }, (_, i) => (
        <circle key={i} r="9" className={styles.customer}>
          <animateMotion
            dur={`${8 + i * 0.7}s`}
            begin={`${-i * 1.3}s`}
            repeatCount="indefinite"
            path={proposed && i % 2 ? second : first}
          />
        </circle>
      ))}
      {Array.from({ length: proposed ? 3 : 8 }, (_, i) => (
        <circle
          key={`queue-${i}`}
          cx={1020 - i * 29}
          cy={650 + i * 9}
          r="9"
          className={styles.customer}
        />
      ))}
      <circle cx="1170" cy="630" r="12" className={styles.employee} />
      {proposed && (
        <circle cx="1100" cy="455" r="12" className={styles.employee} />
      )}
      <circle cx="1045" cy="650" r="25" className={styles.station} />
      {proposed && (
        <circle cx="1015" cy="485" r="25" className={styles.station} />
      )}
    </svg>
  );
});
