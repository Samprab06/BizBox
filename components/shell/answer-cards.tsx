"use client";

import { useState } from "react";
import { updateProfile, type Profile } from "@/components/intake/profile";
import { CurvedRuler } from "@/components/onboarding/curved-ruler";
import {
  categoryChoices,
  cityChoices,
  priceChoices,
  resumeStep,
  rulerBounds,
  rulers,
  stepError,
  titles,
  type QuestionStep,
} from "@/components/onboarding/flow";
import type { IntakeConversation } from "@/components/workspace-screen/use-intake-conversation";
import { answerCardStep, type AnswerCardStep } from "./entry-flow";

/**
 * HAC-150: the guided onboarding's category/city/price chips and curved rulers, shown inline
 * in the chat as answer cards. Their choices, ruler settings and validation are the guided
 * flow's own (components/onboarding/flow.ts); only the presentation is new.
 */

const chip =
  "rounded-full border border-viewport-line px-4 py-2 text-sm font-medium text-viewport-ink hover:bg-viewport-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink";

const choices: Record<
  "category" | "city" | "price",
  readonly { label: string; value: string }[]
> = {
  category: categoryChoices,
  city: cityChoices.map((choice) => ({
    label: choice.value,
    value: choice.value,
  })),
  price: priceChoices,
};

function RulerCard({
  step,
  initial,
  onAnswer,
}: {
  step: "rent" | "buildout" | "staff";
  initial: string;
  onAnswer: (label: string, value: string) => void;
}) {
  const ruler = rulers[step];
  const [value, setValue] = useState(
    /^\d+$/.test(initial) ? Number(initial) : ruler.start,
  );
  const { min, max } = rulerBounds(step, value);
  const text = String(value);
  const error = stepError(step, text);
  const shown = ruler.currency ? `$${value.toLocaleString("en-US")}` : text;
  return (
    <div>
      <CurvedRuler
        value={value}
        min={min}
        max={max}
        step={ruler.step}
        currency={ruler.currency}
        label={ruler.label}
        onChange={setValue}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-viewport-muted">
          {ruler.label}: <strong className="text-viewport-ink">{shown}</strong>
        </p>
        <button
          type="button"
          disabled={error !== undefined}
          onClick={() => onAnswer(shown, text)}
          className={`${chip} bg-viewport-ink text-viewport-canvas disabled:opacity-60`}
        >
          Confirm {shown}
        </button>
      </div>
    </div>
  );
}

function AnswerCard({
  card,
  profile,
  onAnswer,
}: {
  card: AnswerCardStep;
  profile: Profile;
  onAnswer: (step: QuestionStep, label: string, value: string) => void;
}) {
  const { step } = card;
  return (
    <section
      aria-label="Answer card"
      className="mx-5 mb-3 rounded-2xl border border-viewport-line bg-viewport-surface p-4"
    >
      <h3 id={`answer-card-${step}`} className="mb-3 text-sm font-semibold">
        {titles[step]}
      </h3>
      {card.kind === "choice" ? (
        <div
          role="group"
          aria-labelledby={`answer-card-${step}`}
          className="flex flex-wrap gap-2"
        >
          {choices[card.step].map((option) => (
            <button
              key={option.value}
              type="button"
              className={chip}
              onClick={() => onAnswer(step, option.label, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        // Keyed by step, so each question starts from its own saved or starting amount.
        <RulerCard
          key={card.step}
          step={card.step}
          initial={profile[card.step]?.value ?? ""}
          onAnswer={(label, value) => onAnswer(step, label, value)}
        />
      )}
    </section>
  );
}

/**
 * The answer card for the brief's next open question, or null when that question is typed.
 * A confirmed answer takes the guided onboarding's save path (a founder-origin profile edit
 * plus a pending patch) and rides the project's one request queue, so the agent hears it as
 * a chat message and replies with the next question.
 */
export function useAnswerCard(conversation: IntakeConversation) {
  const { session, availability, busy, enqueue, read, save, sendNow } =
    conversation;
  const card = session ? answerCardStep(session.profile) : null;
  if (!session || !card || availability === "checking") return null;
  const live = availability === "live";

  function answer(step: QuestionStep, label: string, value: string) {
    void enqueue(async () => {
      const current = read();
      const pending = live
        ? [...new Set([...(current.pending ?? []), step])]
        : current.pending;
      save({
        ...current,
        profile: updateProfile(current.profile, step, value),
        pending,
      });
      if (live) return sendNow(label, true, {});
      // Offline there is no agent to reply, so the next question comes from the guided flow.
      const after = read();
      const next = resumeStep(after.profile);
      save({
        ...after,
        messages: [
          ...after.messages,
          { role: "founder", text: label },
          ...(next === "review"
            ? []
            : [{ role: "agent" as const, text: titles[next] }]),
        ],
      });
      return null;
    });
  }

  return (
    <fieldset disabled={busy} className="contents">
      <AnswerCard card={card} profile={session.profile} onAnswer={answer} />
    </fieldset>
  );
}
