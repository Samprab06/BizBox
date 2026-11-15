"use client";
import Image from "next/image";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LocationStoryData } from "./location-data";
import type { LandingDemoData } from "../landing-demo/demo-data";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Glass, WordHeading, Icon, dollars } from "../landing-demo/demo-ui";
import { PreparedVideo } from "./prepared-video";
import { PREPARED_MEDIA } from "./prepared-media-data";
import { smooth } from "../landing-demo/timeline";
import { chatAt } from "./timeline";
import { nessieAt } from "./nessie-story";
import { NessieConversation } from "./nessie-conversation";
import styles from "./landing-story.module.css";
import { STORY_ASSETS } from "./asset-paths";
export function LocationDetails({ data }: { data: LocationStoryData }) {
  return (
    <details className={styles.details}>
      <summary>Assumptions & costs</summary>
      <div>
        {data.sites.map((site) => (
          <p key={site.id}>
            {site.name}: {site.arrivals} assumed arrivals · {dollars(site.rent)}{" "}
            / month rent
          </p>
        ))}
        {data.assumptions.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
    </details>
  );
}
export function LocationAnalytics({ data }: { data: LocationStoryData }) {
  const winner = data.sites.find((site) => site.id === data.selectedId)!;
  const other = data.sites.find((site) => site.id !== data.selectedId)!;
  const maxContribution = Math.max(
    ...data.sites.map((site) => site.contributionUsd),
    1,
  );
  return (
    <section className={styles.analytics} aria-label="Modeled location results">
      <div className={styles.sceneTitle}>
        <WordHeading text="Compare the same morning." />
        <p>{data.period} · same café, one staffed counter</p>
      </div>
      <Glass className={styles.analyticsGlass}>
        <div className={styles.resultColumns}>
          {data.sites.map((site) => (
            <div key={site.id} data-winner={site.id === data.selectedId}>
              <h3>{site.name}</h3>
              <dl className={styles.locationMetrics}>
                <div data-primary-value="contribution">
                  <dt>after included costs</dt>
                  <dd>
                    <strong>{dollars(site.contributionUsd)}</strong>
                    <div
                      className={styles.contributionMeter}
                      data-result-chart="contribution"
                      aria-hidden="true"
                    >
                      <i
                        style={{
                          width: `${(site.contributionUsd / maxContribution) * 100}%`,
                        }}
                      />
                    </div>
                  </dd>
                </div>
                <div data-primary-value="served">
                  <dt>customers served</dt>
                  <dd>
                    <strong>{site.served}</strong>
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p className={styles.finding}>
          <strong>
            {winner.name} keeps{" "}
            {dollars(winner.contributionUsd - other.contributionUsd)} more.
          </strong>
          <span>
            Higher assumed demand at {other.name} adds{" "}
            {other.served - winner.served} completed orders.
          </span>
        </p>
        <LocationDetails data={data} />
      </Glass>
    </section>
  );
}
export const LOCATION_PROMPT = "Where should I open my café?";
export const LOCATION_REPLY = [
  "I’ll compare two example spaces using the same café and morning.",
];
export const COUNTER_PROMPT = "What if I add a second staffed counter?";
export function counterReply(demo: LandingDemoData) {
  return [
    `I’ll run the same ${demo.experiment.arrivals}-customer morning with a second staffed counter. It adds ${dollars(demo.experiment.proposed.laborUsd - demo.experiment.current.laborUsd)} in labor and ${dollars(demo.experiment.additionalBuildoutUsd)} in setup.`,
  ];
}

type ChatProps = {
  prompt: string;
  replies: readonly string[];
  elapsed: number;
  reduced: boolean;
  label: string;
  onSend?: () => void;
  children?: ReactNode;
};
function ScriptedConversation({
  prompt,
  replies,
  elapsed,
  reduced,
  label,
  onSend,
  children,
}: ChatProps) {
  const chat = chatAt(prompt, replies, elapsed, reduced);
  return (
    <div
      className={styles.conversation}
      data-chat-state={
        chat.sent
          ? chat.complete
            ? "complete"
            : "replying"
          : chat.sendPressed
            ? "sending"
            : "composing"
      }
    >
      {!chat.sent && (
        <Glass className={styles.composer}>
          <label className={styles.composerLabel}>
            <span className={styles.srOnly}>{label}</span>
            <textarea
              aria-label={label}
              rows={2}
              readOnly
              value={chat.promptText}
              spellCheck={false}
            />
          </label>
          <div className={styles.composerFooter}>
            <button
              type="button"
              aria-label="Send example prompt"
              data-pressed={chat.sendPressed}
              onClick={onSend}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </Glass>
      )}
      {chat.sent && (
        <Glass
          className={`${styles.bubble} ${styles.userBubble}`}
          data-speaker="user"
        >
          <span>You</span>
          <p>{prompt}</p>
        </Glass>
      )}
      {chat.replyVisible && (
        <Glass
          className={`${styles.bubble} ${styles.consultantBubble}`}
          data-speaker="bizbox"
        >
          <BrandLogo onDark className={styles.bubbleBrand} />
          <div aria-hidden="true" className={styles.replyParagraphs}>
            {chat.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph || "\u00a0"}</p>
            ))}
          </div>
          <span className={styles.srOnly}>{replies.join("\n\n")}</span>
          {chat.complete && children}
        </Glass>
      )}
    </div>
  );
}
export function LocationQuestion({
  elapsed,
  reduced,
  onSend,
}: {
  elapsed: number;
  reduced: boolean;
  onSend?: () => void;
}) {
  return (
    <section
      className={styles.questionScene}
      aria-label="Example location question"
    >
      <ScriptedConversation
        prompt={LOCATION_PROMPT}
        replies={LOCATION_REPLY}
        elapsed={elapsed}
        reduced={reduced}
        label="Location question"
        onSend={onSend}
      />
    </section>
  );
}
type InteriorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export function interiorFrame(
  source: InteriorRect,
  viewport: { width: number; height: number },
  mix: number,
): InteriorRect {
  const t = Math.min(1, Math.max(0, mix));
  return {
    left: source.left * (1 - t),
    top: source.top * (1 - t),
    width: source.width + (viewport.width - source.width) * t,
    height: source.height + (viewport.height - source.height) * t,
  };
}
export function ConsultantScene({
  data,
  elapsed,
  reduced,
  onSend,
  onEnter,
  interiorMix = 0,
  cursorMix = 0,
  pan = 0,
}: {
  data: LocationStoryData;
  elapsed: number;
  reduced: boolean;
  onSend?: () => void;
  onEnter?: () => void;
  interiorMix?: number;
  cursorMix?: number;
  pan?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const interiorId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    fullWidth: number;
    fullHeight: number;
  } | null>(null);
  const chat = nessieAt(data, elapsed, reduced);
  const mixRef = useRef(interiorMix);
  const measureRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    mixRef.current = interiorMix;
    if (interiorMix === 0) measureRef.current();
  }, [interiorMix]);
  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current || !preview.current) return;
      const host = root.current.getBoundingClientRect(),
        slot = preview.current.getBoundingClientRect();
      setBounds((old) => {
        // The host never scrolls; slot coordinates already include inner scrolling.
        const source = {
          left: slot.left - host.left,
          top: slot.top - host.top,
          width: slot.width,
          height: slot.height,
        };
        const next = {
          ...source,
          fullWidth: host.width,
          fullHeight: host.height,
        };
        return old &&
          Object.keys(next).every(
            (key) =>
              Math.abs(
                old[key as keyof typeof old] - next[key as keyof typeof next],
              ) < 0.5,
          )
          ? old
          : next;
      });
    };
    measureRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    if (root.current) observer.observe(root.current);
    if (preview.current) observer.observe(preview.current);
    const scrollHost = scroller.current;
    const onScroll = () => {
      if (mixRef.current === 0) measure();
    };
    scrollHost?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scrollHost?.removeEventListener("scroll", onScroll);
      measureRef.current = () => {};
    };
  }, [chat.complete]);
  const imageFrame = bounds
    ? interiorFrame(
        bounds,
        { width: bounds.fullWidth, height: bounds.fullHeight },
        interiorMix,
      )
    : undefined;
  return (
    <section
      ref={root}
      className={styles.consultantScene}
      aria-label="Example consultant recommendation"
      data-interior-mix={interiorMix}
    >
      <div
        ref={scroller}
        className={styles.consultantScroller}
        data-consultant-scroller="true"
        style={{
          pointerEvents: interiorMix > 0 ? "none" : undefined,
          overflow: interiorMix > 0 ? "hidden" : undefined,
        }}
        inert={interiorMix > 0.5}
      >
        <div
          className={styles.consultantConversation}
          style={{
            opacity: 1 - smooth(0, 0.55, interiorMix),
            visibility: interiorMix === 1 ? "hidden" : "visible",
          }}
          inert={interiorMix > 0.5}
        >
          <NessieConversation
            data={data}
            elapsed={elapsed}
            reduced={reduced}
            onSend={onSend}
          >
            <div
              ref={preview}
              className={styles.interiorPreview}
              data-interior-preview="true"
              role="group"
              aria-label="Generated café interior preview"
              aria-owns={interiorId}
            ></div>
          </NessieConversation>
          <p className={styles.qualifier}>
            Simulated banking · modeled costs, not a forecast
          </p>
        </div>
      </div>
      <div
        id={interiorId}
        className={styles.sharedInterior}
        hidden={!chat.complete && interiorMix === 0}
        data-shared-interior="true"
        style={
          imageFrame
            ? { ...imageFrame, borderRadius: 18 * (1 - interiorMix) }
            : undefined
        }
      >
        <Image
          src={STORY_ASSETS.interior.src}
          alt="Generated example café with green tile and walnut furniture"
          style={{
            transform: `scale(${1 + 0.04 * pan}) translateX(${-pan * 0.6}%)`,
          }}
          fill
          unoptimized
          sizes="100vw"
          priority
        />
        <div
          className={styles.interiorPreviewControls}
          style={{
            opacity: 1 - smooth(0, 0.45, interiorMix),
            visibility: interiorMix >= 0.5 ? "hidden" : "visible",
          }}
          inert={interiorMix >= 0.5}
        >
          <button type="button" onClick={onEnter}>
            See inside <Icon name="arrow" />
          </button>
          <svg
            className={styles.demoCursor}
            style={{
              opacity: cursorMix > 0 ? 1 : 0,
              transform: `translate(${(1 - cursorMix) * 45}px,${(1 - cursorMix) * 35}px) scale(${1 - 0.12 * smooth(0.65, 0.8, cursorMix) + 0.12 * smooth(0.8, 1, cursorMix)})`,
            }}
            viewBox="0 0 24 28"
            aria-hidden="true"
          >
            <path
              d="M2 2v20l6-5 5 10 4-2-5-9h9Z"
              fill="white"
              stroke="#25333b"
            />
          </svg>
        </div>
      </div>
      {interiorMix > 0.5 && (
        <span className={styles.imageNote}>Illustrative interior</span>
      )}
    </section>
  );
}
export function MorningScene({
  data,
  elapsed,
  reduced,
}: {
  data: LocationStoryData;
  elapsed: number;
  reduced: boolean;
}) {
  const minute = reduced
    ? 720
    : 480 + Math.min(240, Math.floor(elapsed / 125) * 5);
  const time =
    minute >= 720
      ? "12:00 PM"
      : `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")} AM`;
  return (
    <div
      className={styles.morning}
      aria-label={`Modeled morning · ${data.period}`}
    >
      <div className={styles.sceneTitle}>
        <WordHeading text="Same café. Same morning." />
        <p>{time} · modeled demand, not measured footfall</p>
      </div>
    </div>
  );
}
export function CounterComparison({
  demo,
  running,
  choice,
  onChoice,
  mini = false,
  replayRevision = 0,
  visible = true,
  reduced = false,
  onPlayRequest,
}: {
  demo: LandingDemoData;
  running: boolean;
  choice: "current" | "proposed";
  onChoice: (choice: "current" | "proposed") => void;
  mini?: boolean;
  replayRevision?: number;
  visible?: boolean;
  reduced?: boolean;
  onPlayRequest?: () => void;
}) {
  return (
    <section
      className={styles.counterComparison}
      data-mini={mini}
      aria-label="One versus two staffed counters"
    >
      {!mini && (
        <p className={styles.comparisonContext}>
          Same {demo.experiment.arrivals} customers · {demo.experiment.period}
        </p>
      )}
      <div className={styles.split}>
        {(mini ? [choice] : (["current", "proposed"] as const)).map((id) => {
          const proposed = id === "proposed";
          const setup = demo.experiment[id];
          return (
            <Glass className={styles.setup} key={id}>
              <button
                className={styles.setupLabel}
                type="button"
                onClick={() => onChoice(id)}
                aria-pressed={choice === id}
              >
                {proposed ? "Two staffed counters" : "One staffed counter"}
                {choice === id && <Icon name="check" />}
              </button>
              <div className={styles.floorplan}>
                <PreparedVideo
                  media={PREPARED_MEDIA.counters[id]}
                  label={
                    proposed
                      ? "Recorded two-counter flow"
                      : "Recorded one-counter flow"
                  }
                  active={!mini}
                  running={running}
                  visible={visible}
                  reduced={reduced}
                  loop
                  fit="contain"
                  replayRevision={replayRevision}
                  onPlayRequest={onPlayRequest}
                />
              </div>
              <p className={styles.servedResult}>
                <strong>{setup.served}</strong> customers served
              </p>
            </Glass>
          );
        })}
      </div>
      {!mini && (
        <div className={styles.counterCosts}>
          <Glass className={styles.counterTradeoffs}>
            <dl>
              <div data-tradeoff="customers">
                <dt>customers</dt>
                <dd>
                  +
                  {demo.experiment.proposed.served -
                    demo.experiment.current.served}
                </dd>
              </div>
              <div data-tradeoff="labor">
                <dt>morning labor</dt>
                <dd>
                  +
                  {dollars(
                    demo.experiment.proposed.laborUsd -
                      demo.experiment.current.laborUsd,
                  )}
                </dd>
              </div>
              <div data-tradeoff="setup">
                <dt>setup</dt>
                <dd>+{dollars(demo.experiment.additionalBuildoutUsd)}</dd>
              </div>
            </dl>
          </Glass>
          <details className={styles.details}>
            <summary>Model details</summary>
            <div>
              <p>{demo.source}</p>
              <p>
                One counter: {demo.experiment.current.p90WaitMin?.toFixed(1)}{" "}
                min P90 wait, {dollars(demo.experiment.current.laborUsd)}{" "}
                morning labor. Two counters:{" "}
                {demo.experiment.proposed.p90WaitMin?.toFixed(1)} min P90 wait,{" "}
                {dollars(demo.experiment.proposed.laborUsd)} morning labor.
              </p>
              {Object.entries(demo.experiment.definitions).map(
                ([key, value]) => (
                  <p key={key}>{value}</p>
                ),
              )}
              <p>
                Recorded customer paths illustrate flow, not a replay of the
                seeded events.
              </p>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
export function CounterQuestion({
  demo,
  elapsed,
  reduced,
  onSend,
}: {
  demo: LandingDemoData;
  elapsed: number;
  reduced: boolean;
  onSend?: () => void;
}) {
  return (
    <section
      className={styles.counterQuestion}
      aria-label="Example counter question"
    >
      <ScriptedConversation
        prompt={COUNTER_PROMPT}
        replies={counterReply(demo)}
        elapsed={elapsed}
        reduced={reduced}
        label="Counter question"
        onSend={onSend}
      />
    </section>
  );
}
