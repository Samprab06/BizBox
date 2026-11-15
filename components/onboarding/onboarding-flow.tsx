"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Profile } from "@/components/intake/profile";
import { AreaMap } from "./area-map";
import { ClockDial } from "./clock-dial";
import {
  DEFAULT_RANGE,
  formatHoursValue,
  parseHoursValue,
} from "./clock-dial-math";
import { CurvedRuler } from "./curved-ruler";
import {
  categoryChoices,
  cityChoices,
  comingSoonCities,
  comingSoonCityPhotos,
  initialValue,
  isRulerStep,
  photoCredits,
  priceChoices,
  questionSteps,
  resumeStep,
  reviewLabels,
  reviewValue,
  rulerBounds,
  rulers,
  skipValues,
  stepError,
  titles,
  type City,
  type QuestionStep,
  type Step,
} from "./flow";
import styles from "./onboarding.module.css";
import { Button, buttonVariants, buttonSizes } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Input, Textarea } from "@/components/ui/input";
import { Glass } from "@/components/ui/glass";
import { cn, focusRing, pressable } from "@/components/ui/cn";

const steps: readonly Step[] = [...questionSteps, "review"];

/**
 * HAC-127: the guided BizBox onboarding. It reads the intake profile it is given and saves
 * each confirmed answer through `onCommit`, which is the intake screen's own save path
 * (updateProfile, localStorage, live-API pending patches). It holds only unsaved drafts.
 */
export function OnboardingFlow({
  profile,
  onCommit,
  formHref,
  nextHref,
  onNext,
  notice,
}: {
  profile: Profile;
  onCommit: (key: QuestionStep, value: string) => void;
  formHref: string;
  /** Where "Find my locations" leads: the flow's `locations` step. */
  nextHref: string;
  /** Runs as the founder follows `nextHref` (Scene 1: unlocks the `locations` step). */
  onNext?: () => void;
  notice?: ReactNode;
}) {
  const [step, setStep] = useState<Step>(() => resumeStep(profile));
  const [drafts, setDrafts] = useState<Partial<Record<QuestionStep, string>>>(
    {},
  );
  const [error, setError] = useState<string | undefined>();
  const [returnToReview, setReturnToReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true });
  }, [step]);

  const savedCity = profile.city?.value;
  const city: City = cityChoices.some((choice) => choice.value === savedCity)
    ? (savedCity as City)
    : "Houston";

  function valueOf(key: QuestionStep): string {
    const draft = drafts[key];
    if (draft !== undefined) return draft;
    const initial = initialValue(key, profile);
    return initial === "" && isRulerStep(key)
      ? String(rulers[key].start)
      : initial;
  }

  function go(next: Step) {
    moved.current = true;
    setError(undefined);
    setStep(next);
  }

  function confirm(key: QuestionStep, value: string) {
    const message = stepError(key, value);
    if (message) {
      setError(message);
      return;
    }
    const saved = profile[key];
    if (saved?.value !== value || saved.origin !== "founder")
      onCommit(key, value);
    setDrafts((current) => ({ ...current, [key]: undefined }));
    const next = returnToReview ? "review" : steps[steps.indexOf(key) + 1]!;
    if (next === "review") setReturnToReview(false);
    go(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "review") confirm(step, valueOf(step));
  }

  const setDraft = (key: QuestionStep, value: string) => {
    setError(undefined);
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  const shownCity =
    step === "city"
      ? (cityChoices.find((choice) => choice.value === valueOf("city"))
          ?.value ?? city)
      : city;
  const photo = cityChoices.find((choice) => choice.value === shownCity)!;
  const credit = photoCredits[shownCity];
  const index = steps.indexOf(step);
  const skip = step !== "review" ? skipValues[step] : undefined;

  return (
    <div
      className={`${styles.stage} rounded-panel bg-canvas text-ink flex min-h-[600px] flex-col items-center justify-center px-3 py-6 sm:px-10 sm:py-12`}
    >
      <div className={styles.photo} aria-hidden="true">
        <Image
          key={photo.photo}
          src={photo.photo}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 1100px"
          priority
        />
      </div>
      <div className={`${styles.dim} bg-canvas/70`} aria-hidden="true" />
      <Glass
        role="region"
        aria-labelledby="onboarding-title"
        className="w-full max-w-[45rem] p-5 sm:p-8"
      >
        <form onSubmit={submit} noValidate>
          <div
            key={step}
            className="animate-question-in motion-reduce:animate-none"
            data-step={step}
          >
            <h2
              id="onboarding-title"
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
            >
              {titles[step]}
            </h2>
            <div className="mt-6">
              {step === "review" ? (
                <Review
                  profile={profile}
                  onEdit={(key) => {
                    setReturnToReview(true);
                    go(key);
                  }}
                />
              ) : (
                answer(step)
              )}
            </div>
            {error && (
              <p
                role="alert"
                id="onboarding-error"
                className="mt-4 text-sm font-medium text-danger"
              >
                {error}
              </p>
            )}
            {notice}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            {index > 0 ? (
              <Button
                type="button"
                onClick={() => {
                  setReturnToReview(false);
                  go(steps[index - 1]!);
                }}
                variant="quiet"
              >
                <span aria-hidden="true">←</span> Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {skip && (
                <Button
                  type="button"
                  onClick={() => confirm(step as QuestionStep, skip)}
                  variant="quiet"
                >
                  Skip
                </Button>
              )}
              {step === "review" ? (
                <ReviewActions
                  profile={profile}
                  formHref={formHref}
                  nextHref={nextHref}
                  onNext={onNext}
                  onFix={go}
                />
              ) : (
                <Button type="submit" variant="primary">
                  Continue <span aria-hidden="true">→</span>
                </Button>
              )}
            </div>
          </div>
        </form>
      </Glass>
      <p className="mt-4 text-center text-xs text-muted">
        {shownCity} photo:{" "}
        <a
          className={cn("underline", focusRing)}
          href={credit.source}
          target="_blank"
          rel="noreferrer"
        >
          {credit.author}
        </a>
        ,{" "}
        <a
          className={cn("underline", focusRing)}
          href={credit.licenseUrl}
          target="_blank"
          rel="noreferrer"
        >
          {credit.license}
        </a>
      </p>
    </div>
  );

  function answer(key: QuestionStep): ReactNode {
    const value = valueOf(key);
    const describedBy = error ? "onboarding-error" : undefined;
    const text = (options: {
      textarea?: boolean;
      maxLength: number;
      placeholder: string;
    }) =>
      options.textarea ? (
        <Textarea
          aria-labelledby="onboarding-title"
          aria-describedby={describedBy}
          className="min-h-28 resize-y text-base"
          maxLength={options.maxLength}
          placeholder={options.placeholder}
          value={value}
          onChange={(event) => setDraft(key, event.target.value)}
        />
      ) : (
        <Input
          aria-labelledby="onboarding-title"
          aria-describedby={describedBy}
          className="h-auto py-3 text-base"
          maxLength={options.maxLength}
          placeholder={options.placeholder}
          value={value}
          onChange={(event) => setDraft(key, event.target.value)}
        />
      );

    switch (key) {
      case "category":
        return (
          <div
            role="group"
            aria-labelledby="onboarding-title"
            className="grid grid-cols-2 gap-3"
          >
            {categoryChoices.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={value === option.value ? "primary" : "glass"}
                aria-pressed={value === option.value}
                className="h-auto min-h-12 justify-center rounded-control px-4 py-4 font-medium"
                onClick={() => setDraft(key, option.value)}
              >
                {option.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="glass"
              disabled
              className="col-span-2 h-auto min-h-12 justify-center px-4 py-4 font-medium"
            >
              Other <Pill className="text-[10px] font-normal">Coming soon</Pill>
            </Button>
          </div>
        );
      case "concept":
        return text({
          textarea: true,
          maxLength: 400,
          placeholder: "A neighborhood coffee shop with room to work and meet…",
        });
      case "customers":
        return text({
          textarea: true,
          maxLength: 250,
          placeholder: "Residents, commuters, students…",
        });
      case "hours":
        return (
          <ClockDial
            value={parseHoursValue(value) ?? DEFAULT_RANGE}
            onChange={(next) => setDraft(key, formatHoursValue(next))}
            labelledBy="onboarding-title"
            describedBy={describedBy}
          />
        );
      case "requirements":
        return text({
          textarea: true,
          maxLength: 300,
          placeholder: "Street frontage, parking, ground floor…",
        });
      case "city":
        return (
          <>
            <div
              role="group"
              aria-labelledby="onboarding-title"
              className="grid grid-cols-2 gap-3"
            >
              {cityChoices.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={value === option.value}
                  onClick={() => setDraft(key, option.value)}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-control border border-glass-edge bg-glass-fill p-0 text-left text-ink backdrop-blur-glass hover:bg-panel-raised",
                    "aria-pressed:border-accent aria-pressed:bg-white/[0.08] aria-pressed:ring-1 aria-pressed:ring-accent",
                    pressable,
                    focusRing,
                  )}
                >
                  <span className="relative block aspect-video">
                    <Image
                      src={option.photo}
                      alt={option.alt}
                      fill
                      sizes="(max-width: 640px) 45vw, 260px"
                      className="object-cover"
                    />
                  </span>
                  <span className="flex items-center justify-between bg-glass-fallback px-3 py-2 text-sm font-medium text-ink">
                    {option.value}
                    <span
                      aria-hidden="true"
                      className={`h-3 w-3 rounded-full border ${value === option.value ? "border-accent bg-accent ring-2 ring-accent/30" : "border-glass-edge"}`}
                    />
                  </span>
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label="Coming soon cities"
              className="mt-3 grid grid-cols-3 gap-2"
            >
              {comingSoonCities.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant="glass"
                  disabled
                  className="h-auto flex-col items-stretch gap-0 overflow-hidden rounded-control p-0 text-left text-xs"
                >
                  <span className="relative block aspect-[4/3]">
                    <Image
                      src={comingSoonCityPhotos[name]}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 28vw, 180px"
                      className="object-cover"
                    />
                    <span className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/15 to-transparent p-2 text-white sm:p-3">
                      <strong className="block font-medium">{name}</strong>{" "}
                      <span className="mt-0.5 text-[10px] text-white/85">Coming soon</span>
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </>
        );
      case "areas":
        return (
          <AreaMap
            key={city}
            city={city}
            value={value}
            onChange={(next) => setDraft(key, next)}
          />
        );
      case "rent":
      case "buildout":
      case "staff": {
        const ruler = rulers[key];
        const amount = /^\d+$/.test(value.trim())
          ? Number(value.trim())
          : Number.NaN;
        const bounds = rulerBounds(key, amount);
        return (
          <div>
            <div className="flex items-baseline justify-center gap-1 text-5xl font-semibold tabular-nums">
              {ruler.currency && <span aria-hidden="true">$</span>}
              <input
                aria-label={`${ruler.label}${ruler.currency ? " in dollars" : ""}, exact amount`}
                aria-describedby={describedBy}
                aria-invalid={error !== undefined}
                inputMode="numeric"
                autoComplete="off"
                className={`w-[7ch] min-w-0 border-b border-glass-edge bg-transparent text-center tabular-nums ${focusRing}`}
                value={value}
                onChange={(event) => setDraft(key, event.target.value)}
              />
            </div>
            <div className="mt-6">
              <CurvedRuler
                value={amount}
                min={bounds.min}
                max={bounds.max}
                step={ruler.step}
                currency={ruler.currency}
                label={`Adjust ${ruler.label.toLowerCase()}`}
                onChange={(next) => setDraft(key, String(next))}
              />
            </div>
          </div>
        );
      }
      case "price":
        return (
          <div
            role="group"
            aria-labelledby="onboarding-title"
            className="grid grid-cols-3 gap-3"
          >
            {priceChoices.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={value === option.value ? "primary" : "glass"}
                aria-pressed={value === option.value}
                className="h-auto min-h-12 justify-center rounded-control px-4 py-4 font-medium"
                onClick={() => setDraft(key, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        );
    }
  }
}

function Review({
  profile,
  onEdit,
}: {
  profile: Profile;
  onEdit: (key: QuestionStep) => void;
}) {
  return (
    <dl className="divide-y divide-line text-sm">
      {questionSteps.map((key) => {
        const value = profile[key]?.value ?? "";
        return (
          <div key={key} className="flex items-start gap-3 py-2.5">
            <dt className="w-28 shrink-0 text-muted">{reviewLabels[key]}</dt>
            <dd className="min-w-0 flex-1 break-words">
              {value ? (
                reviewValue(key, value)
              ) : (
                <span className="text-danger">Not answered</span>
              )}
            </dd>
            <dd className="shrink-0">
              <Button
                type="button"
                aria-label={`Edit ${reviewLabels[key].toLowerCase()}`}
                onClick={() => onEdit(key)}
                variant="quiet"
                size="sm"
                className="text-xs underline-offset-2 hover:underline"
              >
                Edit
              </Button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ReviewActions({
  profile,
  formHref,
  nextHref,
  onNext,
  onFix,
}: {
  profile: Profile;
  formHref: string;
  nextHref: string;
  onNext?: () => void;
  onFix: (step: Step) => void;
}) {
  const invalid = questionSteps.find(
    (key) => stepError(key, profile[key]?.value ?? "") !== undefined,
  );
  return (
    <>
      <Link
        href={formHref}
        className={cn(
          "inline-flex items-center justify-center rounded-control underline-offset-2 hover:underline",
          buttonVariants.quiet,
          buttonSizes.md,
          focusRing,
          pressable,
        )}
      >
        Edit all fields
      </Link>
      {invalid ? (
        <Button type="button" onClick={() => onFix(invalid)} variant="primary">
          Finish {reviewLabels[invalid].toLowerCase()}{" "}
          <span aria-hidden="true">→</span>
        </Button>
      ) : (
        <Link
          href={nextHref}
          onClick={onNext}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-control",
            buttonVariants.primary,
            buttonSizes.md,
            focusRing,
            pressable,
          )}
        >
          Find my locations <span aria-hidden="true">→</span>
        </Link>
      )}
    </>
  );
}
