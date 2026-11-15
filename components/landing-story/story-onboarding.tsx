"use client";
import type { CSSProperties } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Glass, Icon, WordHeading, dollars } from "../landing-demo/demo-ui";
import type { LandingDemoData } from "../landing-demo/demo-data";
import { onboardingInputAt } from "./story-onboarding-model";
import styles from "./story-onboarding.module.css";

type Props = {
  demo: LandingDemoData;
  ready: boolean;
  style: CSSProperties;
  elapsed: number;
  reduced: boolean;
  paused: boolean;
  onPause: () => void;
  onReplay: () => void;
  onSkip: () => void;
  onContinue: () => void;
};

export function StoryOnboarding({
  demo,
  ready,
  style,
  elapsed,
  reduced,
  paused,
  onPause,
  onReplay,
  onSkip,
  onContinue,
}: Props) {
  const state = onboardingInputAt(ready ? elapsed : 700, ready && reduced);
  const rent =
    Math.round((demo.business.rentLimit - 1000 + state.rentMix * 1000) / 50) *
    50;
  const staff = demo.business.staff + state.staffOffset;
  const done = ready && (reduced || elapsed >= 7000);
  const concept = demo.business.concept.slice(
    0,
    Math.round(demo.business.concept.length * state.conceptMix),
  );
  return (
    <>
      {ready && (
        <div className={styles.heading}>
          <WordHeading text="Understand your business." />
        </div>
      )}
      <div
        className={styles.camera}
        style={style}
        inert={!ready}
        data-onboarding-ready={ready}
      >
        <Glass
          className={styles.panel}
          data-onboarding-panel="true"
          data-input-step={state.step}
        >
          <BrandLogo onDark className={styles.brand} />
          <div className={styles.stage}>
            {state.step === "category" && (
              <div className={styles.beat}>
                <h3>What are you opening?</h3>
                <div className={styles.categories}>
                  {[
                    ["cup", "Coffee shop"],
                    ["food", "Quick food"],
                    ["salon", "Salon"],
                    ["fitness", "Fitness"],
                  ].map(([icon, label]) => (
                    <div
                      key={label}
                      className={styles.category}
                      data-selected={
                        label === "Coffee shop" && state.categorySelected
                      }
                    >
                      <Icon name={icon} />
                      <span>{label}</span>
                      {label === "Coffee shop" && state.categorySelected && (
                        <Icon name="check" />
                      )}
                    </div>
                  ))}
                </div>
                <span className={styles.city}>
                  <Icon name="pin" />
                  {demo.business.city}
                </span>
              </div>
            )}
            {state.step === "concept" && (
              <div className={styles.beat}>
                <h3>What’s the idea?</h3>
                <textarea
                  className={styles.concept}
                  readOnly
                  tabIndex={-1}
                  value={concept}
                  aria-label="Example café business description"
                />
                <span className={styles.city}>
                  <Icon name="pin" />
                  {demo.business.city}
                </span>
              </div>
            )}
            {state.step === "budget" && (
              <div className={styles.beat}>
                <h3>Set your starting point.</h3>
                <div className={styles.rentHeader}>
                  <span>Monthly rent limit</span>
                  <output>{dollars(rent)}</output>
                </div>
                <input
                  className={styles.slider}
                  type="range"
                  min={2000}
                  max={6000}
                  step={50}
                  value={rent}
                  disabled
                  aria-label="Example monthly rent limit"
                  style={
                    { "--fill": `${(rent - 2000) / 40}%` } as CSSProperties
                  }
                />
                <div className={styles.sliderEnds}>
                  <span>$2,000</span>
                  <span>$6,000</span>
                </div>
                <div className={styles.staff}>
                  <span>People on shift</span>
                  <div>
                    <span
                      className={styles.stepper}
                      data-pressed={state.staffOffset === 0}
                      aria-hidden="true"
                    >
                      −
                    </span>
                    <output aria-label="Example people on shift">
                      {staff}
                    </output>
                    <span className={styles.stepper} aria-hidden="true">
                      +
                    </span>
                  </div>
                </div>
              </div>
            )}
            {state.step === "review" && (
              <div className={styles.beat}>
                <h3>
                  {state.locked
                    ? "Your café. Locked in."
                    : "A good starting point."}
                </h3>
                <dl className={styles.review}>
                  <div>
                    <dt>Business</dt>
                    <dd>Coffee + breakfast</dd>
                  </div>
                  <div>
                    <dt>City</dt>
                    <dd>{demo.business.city}</dd>
                  </div>
                  <div>
                    <dt>Monthly rent limit</dt>
                    <dd>{dollars(demo.business.rentLimit)}</dd>
                  </div>
                  <div>
                    <dt>People on shift</dt>
                    <dd>{demo.business.staff}</dd>
                  </div>
                </dl>
                <div className={styles.confirm} data-locked={state.locked}>
                  <Icon name="check" />
                  <span>
                    {state.locked
                      ? "Business brief saved"
                      : "Confirming your brief"}
                  </span>
                </div>
              </div>
            )}
          </div>
          {ready && (
            <div className={styles.controls}>
              <div
                className={styles.progress}
                role="progressbar"
                aria-label="Business setup demonstration"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.progress * 100)}
              >
                <span style={{ width: `${state.progress * 100}%` }} />
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={done ? onReplay : onPause}
                  aria-label={
                    done
                      ? "Replay business setup"
                      : paused
                        ? "Resume business setup"
                        : "Pause business setup"
                  }
                >
                  <Icon name={done ? "replay" : paused ? "play" : "pause"} />
                </button>
                {done ? (
                  <button
                    className={styles.next}
                    type="button"
                    onClick={onContinue}
                  >
                    Find a location <Icon name="arrow" />
                  </button>
                ) : (
                  <button type="button" onClick={onSkip}>
                    Skip
                  </button>
                )}
              </div>
            </div>
          )}
        </Glass>
      </div>
    </>
  );
}
