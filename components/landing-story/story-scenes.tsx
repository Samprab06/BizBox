"use client";
import Image from "next/image";
import type { LocationStoryData } from "./location-data";
import type { LandingDemoData } from "../landing-demo/demo-data";
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  Glass,
  WordHeading,
  Icon,
  dollars,
  number,
} from "../landing-demo/demo-ui";
import { CustomerFlow } from "../landing-demo/customer-flow";
import { smooth } from "../landing-demo/timeline";
import { typingAt } from "./timeline";
import styles from "./landing-story.module.css";
export function LocationDetails({ data }: { data: LocationStoryData }) {
  return (
    <details className={styles.details}>
      <summary>Assumptions & costs</summary>
      <div>
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
                <div>
                  <dt>customers served</dt>
                  <dd>
                    <strong>{site.served}</strong>
                  </dd>
                </div>
                <div>
                  <dt>after included costs</dt>
                  <dd>
                    <strong>{dollars(site.contributionUsd)}</strong>
                  </dd>
                </div>
              </dl>
              <p className={styles.siteAssumptions}>
                <span>{site.arrivals} assumed arrivals</span>
                <span>{dollars(site.rent)} / month rent</span>
              </p>
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
export function ConsultantScene({
  data,
  elapsed,
  reduced,
}: {
  data: LocationStoryData;
  elapsed: number;
  reduced: boolean;
}) {
  const message = data.consultant.messages.join("\n\n");
  return (
    <section
      className={styles.consultantScene}
      aria-label="Example consultant recommendation"
    >
      <Glass className={`${styles.bubble} ${styles.userBubble}`}>
        <span>You</span>
        <p>{data.consultant.question}</p>
      </Glass>
      <Glass className={`${styles.bubble} ${styles.consultantBubble}`}>
        <BrandLogo onDark className={styles.bubbleBrand} />
        <p aria-hidden="true">
          {typingAt(message, elapsed, 350, reduced)}
          <span className={styles.caret} />
        </p>
        <span className={styles.srOnly}>{message}</span>
      </Glass>
      <p className={styles.qualifier}>
        Prepared example · modeled, not a forecast
      </p>
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
export function InteriorScene({
  data,
  mix,
  onEnter,
  cursorMix,
  pan,
}: {
  data: LocationStoryData;
  mix: number;
  onEnter: () => void;
  cursorMix: number;
  pan: number;
}) {
  const selected = data.sites.find((site) => site.id === data.selectedId)!;
  return (
    <section
      className={styles.interiorScene}
      aria-label="Illustrative café interior"
    >
      <div
        className={styles.interiorImage}
        style={{
          clipPath: `inset(${(1 - mix) * 23}% ${(1 - mix) * 18}% round ${(1 - mix) * 22}px)`,
        }}
      >
        <Image
          src="/landing-assets/guided-demo/cafe-interior-v1.png"
          alt="Generated example café with green tile and walnut furniture"
          style={{
            transform: `scale(${1 + 0.04 * pan}) translateX(${-pan * 0.6}%)`,
          }}
          fill
          sizes="100vw"
          priority
        />
      </div>
      <div
        className={styles.interiorPrompt}
        style={{
          opacity: 1 - mix,
          visibility: mix === 1 ? "hidden" : "visible",
        }}
      >
        <Glass className={styles.insideButton}>
          <button type="button" onClick={onEnter}>
            See inside <Icon name="arrow" />
          </button>
          <span>{selected.name} · example space</span>
          <small>
            {dollars(selected.rent)} / month · {number(selected.size)} sq ft
          </small>
        </Glass>
        <svg
          className={styles.demoCursor}
          style={{
            transform: `translate(${(1 - cursorMix) * 70}px,${(1 - cursorMix) * 75}px) scale(${1 - 0.12 * smooth(0.65, 0.8, cursorMix) + 0.12 * smooth(0.8, 1, cursorMix)})`,
          }}
          viewBox="0 0 24 28"
          aria-hidden="true"
        >
          <path d="M2 2v20l6-5 5 10 4-2-5-9h9Z" fill="white" stroke="#25333b" />
        </svg>
      </div>
      <span className={styles.imageNote}>Illustrative interior</span>
    </section>
  );
}
export function CounterComparison({
  demo,
  running,
  choice,
  onChoice,
  mini = false,
  replayRevision = 0,
}: {
  demo: LandingDemoData;
  running: boolean;
  choice: "current" | "proposed";
  onChoice: (choice: "current" | "proposed") => void;
  mini?: boolean;
  replayRevision?: number;
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
                <Image
                  src={
                    proposed
                      ? "/landing-assets/guided-demo/cafe-overhead-two-counters-v3.png"
                      : "/landing-assets/guided-demo/cafe-overhead-one-counter-v2.png"
                  }
                  alt={
                    proposed
                      ? "Two-counter café including freestanding green-tile island"
                      : "One wall-side service counter"
                  }
                  fill
                  sizes="(max-width:700px) 85vw,45vw"
                />
                <CustomerFlow
                  key={`${id}-${replayRevision}`}
                  proposed={proposed}
                  running={running}
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
                Customer paths are illustrative motion, not a replay of the
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
  elapsed,
  reduced,
}: {
  elapsed: number;
  reduced: boolean;
}) {
  const text = "What if I add a second staffed counter?";
  return (
    <div className={styles.counterQuestion}>
      <Glass className={`${styles.bubble} ${styles.userBubble}`}>
        <span>You</span>
        <p aria-hidden="true">
          {typingAt(text, elapsed, 100, reduced)}
          <span className={styles.caret} />
        </p>
        <span className={styles.srOnly}>{text}</span>
      </Glass>
    </div>
  );
}
