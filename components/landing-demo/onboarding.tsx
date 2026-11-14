"use client";
import { memo, useEffect, useState } from "react";
import type { LandingDemoData } from "./demo-data";
import type { OnboardingStep } from "./timeline";
import { Glass, Icon, dollars } from "./demo-ui";
import styles from "./landing-demo.module.css";
export const Onboarding = memo(function Onboarding({
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
  const [transition, setTransition] = useState<{
    active: OnboardingStep;
    previous: OnboardingStep | null;
  }>({ active: step, previous: null });
  if (step !== transition.active)
    setTransition({ active: step, previous: transition.active });
  useEffect(() => {
    if (!transition.previous) return;
    const timer = setTimeout(
      () => setTransition((current) => ({ ...current, previous: null })),
      180,
    );
    return () => clearTimeout(timer);
  }, [transition.active, transition.previous]);
  return (
    <Glass className={styles.onboardingPanel}>
      <div className={styles.questionStage}>
        {transition.previous && (
          <div
            className={styles.questionLeaving}
            key={`out-${transition.previous}`}
            aria-hidden="true"
          >
            <QuestionBody demo={demo} step={transition.previous} />
          </div>
        )}
        <div className={styles.questionContent} key={transition.active}>
          <QuestionBody demo={demo} step={transition.active} />
        </div>
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
              Compare locations <Icon name="arrow" />
            </button>
          )}
        </div>
      </div>
    </Glass>
  );
});

const questions: Record<OnboardingStep, string> = {
  category: "What are you opening?",
  concept: "Describe your business.",
  city: "Where are you looking?",
  budget: "What’s your monthly rent limit?",
  staff: "How many people will be on shift?",
  review: "Review your business.",
};

function QuestionBody({
  demo,
  step,
}: {
  demo: LandingDemoData;
  step: OnboardingStep;
}) {
  return (
    <>
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
    </>
  );
}
