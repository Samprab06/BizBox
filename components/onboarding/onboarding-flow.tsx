"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Profile } from "@/components/intake/profile";
import { CurvedRuler } from "./curved-ruler";
import {
  categoryChoices,
  cityChoices,
  comingSoonCities,
  formatAreas,
  initialValue,
  isRulerStep,
  neighborhoods,
  parseAreas,
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
  type AreaChoices,
  type City,
  type QuestionStep,
  type Step,
} from "./flow";
import styles from "./onboarding.module.css";

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
  mapHref,
  notice,
}: {
  profile: Profile;
  onCommit: (key: QuestionStep, value: string) => void;
  formHref: string;
  mapHref: string;
  notice?: ReactNode;
}) {
  const [step, setStep] = useState<Step>(() => resumeStep(profile));
  const [drafts, setDrafts] = useState<Partial<Record<QuestionStep, string>>>({});
  const [areaDraft, setAreaDraft] = useState<AreaChoices | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [returnToReview, setReturnToReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true });
  }, [step]);

  const savedCity = profile.city?.value;
  const city: City = cityChoices.some((choice) => choice.value === savedCity) ? (savedCity as City) : "Houston";

  function valueOf(key: QuestionStep): string {
    if (key === "areas") return areaDraft ? formatAreas(areaDraft) : (profile.areas?.value ?? "");
    const draft = drafts[key];
    if (draft !== undefined) return draft;
    const initial = initialValue(key, profile);
    return initial === "" && isRulerStep(key) ? String(rulers[key].start) : initial;
  }

  function go(next: Step) {
    moved.current = true;
    setError(undefined);
    if (next === "areas") setAreaDraft(parseAreas(profile.areas?.value ?? "", city));
    setStep(next);
  }

  function confirm(key: QuestionStep, value: string) {
    const message = stepError(key, value);
    if (message) {
      setError(message);
      return;
    }
    const saved = profile[key];
    if (saved?.value !== value || saved.origin !== "founder") onCommit(key, value);
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

  const shownCity = step === "city" ? (cityChoices.find((choice) => choice.value === valueOf("city"))?.value ?? city) : city;
  const photo = cityChoices.find((choice) => choice.value === shownCity)!;
  const credit = photoCredits[shownCity];
  const index = steps.indexOf(step);
  const skip = step !== "review" ? skipValues[step] : undefined;

  return (
    <div className={`${styles.stage} flex min-h-[600px] flex-col items-center justify-center px-3 py-6 sm:px-10 sm:py-12`}>
      <div className={styles.photo} aria-hidden="true">
        <Image key={photo.photo} src={photo.photo} alt="" fill sizes="(max-width: 768px) 100vw, 1100px" priority />
      </div>
      <div className={styles.dim} aria-hidden="true" />
      <section aria-labelledby="onboarding-title" className={`${styles.glass} w-full max-w-xl p-5 sm:p-8`}>
        <form onSubmit={submit} noValidate>
          <div key={step} className={styles.fade} data-step={step}>
            <h2 id="onboarding-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
              {titles[step]}
            </h2>
            <div className="mt-6">{step === "review" ? <Review profile={profile} onEdit={(key) => { setReturnToReview(true); go(key); }} /> : answer(step)}</div>
            {error && (
              <p role="alert" id="onboarding-error" className="mt-4 text-sm font-medium text-amber-200">
                {error}
              </p>
            )}
            {notice}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            {index > 0 ? (
              <button type="button" onClick={() => { setReturnToReview(false); go(steps[index - 1]!); }} className="rounded-full px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
                <span aria-hidden="true">←</span> Back
              </button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {skip && (
                <button type="button" onClick={() => confirm(step as QuestionStep, skip)} className="rounded-full px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
                  Skip
                </button>
              )}
              {step === "review" ? (
                <ReviewActions profile={profile} formHref={formHref} mapHref={mapHref} onFix={go} />
              ) : (
                <button type="submit" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#10131b] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  Continue <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
      <p className="mt-4 text-center text-xs text-white/80">
        {shownCity} photo:{" "}
        <a className="underline" href={credit.source} target="_blank" rel="noreferrer">
          {credit.author}
        </a>
        ,{" "}
        <a className="underline" href={credit.licenseUrl} target="_blank" rel="noreferrer">
          {credit.license}
        </a>
      </p>
    </div>
  );

  function answer(key: QuestionStep): ReactNode {
    const value = valueOf(key);
    const describedBy = error ? "onboarding-error" : undefined;
    const field = "w-full rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/60 focus:border-white/70 focus:outline-none";
    const choice = (pressed: boolean) =>
      `flex items-center justify-center gap-2 rounded-2xl border px-4 py-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white ${pressed ? "border-white bg-white text-[#10131b]" : "border-white/25 bg-white/5 text-white hover:bg-white/10"}`;
    const text = (options: { textarea?: boolean; maxLength: number; placeholder: string }) =>
      options.textarea ? (
        <textarea aria-labelledby="onboarding-title" aria-describedby={describedBy} className={`${field} min-h-28 resize-y`} maxLength={options.maxLength} placeholder={options.placeholder} value={value} onChange={(event) => setDraft(key, event.target.value)} />
      ) : (
        <input aria-labelledby="onboarding-title" aria-describedby={describedBy} className={field} maxLength={options.maxLength} placeholder={options.placeholder} value={value} onChange={(event) => setDraft(key, event.target.value)} />
      );

    switch (key) {
      case "category":
        return (
          <div role="group" aria-labelledby="onboarding-title" className="grid grid-cols-2 gap-3">
            {categoryChoices.map((option) => (
              <button key={option.value} type="button" aria-pressed={value === option.value} className={choice(value === option.value)} onClick={() => setDraft(key, option.value)}>
                {option.label}
              </button>
            ))}
            <button type="button" disabled className="col-span-2 flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.02] px-4 py-4 text-sm font-medium text-white/50">
              Other{" "}
              <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-normal">Coming soon</span>
            </button>
          </div>
        );
      case "concept":
        return text({ textarea: true, maxLength: 400, placeholder: "A neighborhood coffee shop with room to work and meet…" });
      case "customers":
        return text({ textarea: true, maxLength: 250, placeholder: "Residents, commuters, students…" });
      case "hours":
        return text({ maxLength: 80, placeholder: "7am – 6pm" });
      case "requirements":
        return text({ textarea: true, maxLength: 300, placeholder: "Street frontage, parking, ground floor…" });
      case "city":
        return (
          <>
            <div role="group" aria-labelledby="onboarding-title" className="grid grid-cols-2 gap-3">
              {cityChoices.map((option) => (
                <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => setDraft(key, option.value)} className={`overflow-hidden rounded-2xl border text-left focus-visible:outline-2 focus-visible:outline-white ${value === option.value ? "border-white ring-2 ring-white" : "border-white/25"}`}>
                  <span className="relative block aspect-video">
                    <Image src={option.photo} alt={option.alt} fill sizes="(max-width: 640px) 45vw, 260px" className="object-cover" />
                  </span>
                  <span className="flex items-center justify-between bg-black/40 px-3 py-2 text-sm font-medium">
                    {option.value}
                    <span aria-hidden="true" className={`h-3 w-3 rounded-full border ${value === option.value ? "border-white bg-white" : "border-white/70"}`} />
                  </span>
                </button>
              ))}
            </div>
            <div role="group" aria-label="Coming soon cities" className="mt-3 grid grid-cols-3 gap-2">
              {comingSoonCities.map((name) => (
                <button key={name} type="button" disabled className="cursor-not-allowed rounded-xl border border-white/15 px-2 py-2 text-xs text-white/50">
                  <strong className="block font-medium">{name}</strong>{" "}
                  <span className="text-[10px]">Coming soon</span>
                </button>
              ))}
            </div>
          </>
        );
      case "areas": {
        const picks = areaDraft ?? parseAreas(profile.areas?.value ?? "", city);
        const update = (next: AreaChoices) => {
          setError(undefined);
          setAreaDraft(next);
        };
        const toggle = (name: string, list: "favor" | "avoid") => {
          const other = list === "favor" ? "avoid" : "favor";
          const on = picks[list].includes(name);
          update({
            ...picks,
            [list]: on ? picks[list].filter((entry) => entry !== name) : [...picks[list], name],
            [other]: picks[other].filter((entry) => entry !== name),
          });
        };
        return (
          <div className="space-y-4">
            {(["favor", "avoid"] as const).map((list) => (
              <div key={list} role="group" aria-label={list === "favor" ? "Favor" : "Avoid"} className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-sm text-white/80" aria-hidden="true">{list === "favor" ? "Favor" : "Avoid"}</span>
                {neighborhoods[city].map((name) => (
                  <button key={name} type="button" aria-pressed={picks[list].includes(name)} aria-label={`${list === "favor" ? "Favor" : "Avoid"} ${name}`} onClick={() => toggle(name, list)} className={`rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-white ${picks[list].includes(name) ? "border-white bg-white text-[#10131b]" : "border-white/30 text-white hover:bg-white/10"}`}>
                    {name}
                  </button>
                ))}
              </div>
            ))}
            <textarea aria-label="Other area notes" aria-describedby={describedBy} className={`${field} min-h-20 resize-y`} maxLength={250} placeholder="Walkable streets, near offices. Avoid shopping centers…" value={picks.notes} onChange={(event) => update({ ...picks, notes: event.target.value })} />
          </div>
        );
      }
      case "rent":
      case "buildout":
      case "staff": {
        const ruler = rulers[key];
        const amount = /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
        const bounds = rulerBounds(key, amount);
        return (
          <div>
            <div className="flex items-baseline justify-center gap-1 text-5xl font-semibold tabular-nums">
              {ruler.currency && <span aria-hidden="true">$</span>}
              <input
                aria-label={`${ruler.label}${ruler.currency ? " in dollars" : ""}, exact amount`}
                aria-describedby={describedBy}
                inputMode="numeric"
                autoComplete="off"
                className="w-[7ch] min-w-0 border-b border-white/30 bg-transparent text-center tabular-nums focus:border-white focus:outline-none"
                value={value}
                onChange={(event) => setDraft(key, event.target.value)}
              />
            </div>
            <div className="mt-6">
              <CurvedRuler value={amount} min={bounds.min} max={bounds.max} step={ruler.step} currency={ruler.currency} label={`Adjust ${ruler.label.toLowerCase()}`} onChange={(next) => setDraft(key, String(next))} />
            </div>
          </div>
        );
      }
      case "price":
        return (
          <div role="group" aria-labelledby="onboarding-title" className="grid grid-cols-3 gap-3">
            {priceChoices.map((option) => (
              <button key={option.value} type="button" aria-pressed={value === option.value} className={choice(value === option.value)} onClick={() => setDraft(key, option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        );
    }
  }
}

function Review({ profile, onEdit }: { profile: Profile; onEdit: (key: QuestionStep) => void }) {
  return (
    <dl className="divide-y divide-white/15 text-sm">
      {questionSteps.map((key) => {
        const value = profile[key]?.value ?? "";
        return (
          <div key={key} className="flex items-start gap-3 py-2.5">
            <dt className="w-28 shrink-0 text-white/75">{reviewLabels[key]}</dt>
            <dd className="min-w-0 flex-1 break-words">{value ? reviewValue(key, value) : <span className="text-amber-200">Not answered</span>}</dd>
            <dd className="shrink-0">
              <button type="button" aria-label={`Edit ${reviewLabels[key].toLowerCase()}`} onClick={() => onEdit(key)} className="rounded-full px-2 py-0.5 text-xs font-medium text-white underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white">
                Edit
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ReviewActions({ profile, formHref, mapHref, onFix }: { profile: Profile; formHref: string; mapHref: string; onFix: (step: Step) => void }) {
  const invalid = questionSteps.find((key) => stepError(key, profile[key]?.value ?? "") !== undefined);
  return (
    <>
      <Link href={formHref} className="rounded-full px-4 py-2 text-sm font-medium text-white/90 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-white">
        Edit all fields
      </Link>
      {invalid ? (
        <button type="button" onClick={() => onFix(invalid)} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#10131b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Finish {reviewLabels[invalid].toLowerCase()} <span aria-hidden="true">→</span>
        </button>
      ) : (
        <Link href={mapHref} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#10131b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Explore locations <span aria-hidden="true">→</span>
        </Link>
      )}
    </>
  );
}
