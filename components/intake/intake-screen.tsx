"use client";

import { Markdown } from "@/components/ui/markdown";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { useConsultant, useConsultantVoice } from "@/components/shell/consultant-shell";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { flowStepHref, reachStep, updateFlowState } from "@/lib/client/flow-progress";
import Link from "next/link";
import { VOICE_LIMITS } from "@/lib/voice/contracts";
import { useState, useSyncExternalStore } from "react";
import { sessionOrInitial, type IntakeCopy } from "@/components/workspace-screen/intake-conversation";
import type { IntakeConversation, SendOptions } from "@/components/workspace-screen/use-intake-conversation";
import { assumptionRows } from "./live";
import { intakeReadiness } from "./readiness";
import { answerPrompt, fields, missingFields, profileValidationMessage, editIntakeField } from "./profile";

type Key = (typeof fields)[number]["key"];

/** Wording for the detailed form; the request itself is the workspace assistant's (HAC-129). */
const formCopy: IntakeCopy = {
  unreachable: "Could not reach the intake service.",
  unavailable: "Intake is temporarily unavailable. Please try again.",
  unexpected: "The intake service sent an unexpected reply. Please try again.",
};

const subscribe = () => () => {};

/** HAC-127: the guided BizBox onboarding is the default; `?mode=form` opens every field at once. */
export type IntakeMode = "guided" | "form";

export function intakeHref(projectId: string, mode: IntakeMode, siteId?: string) {
  const base = workspaceHref(projectId, "intake", siteId);
  return mode === "form" ? `${base}${base.includes("?") ? "&" : "?"}mode=form` : base;
}

export function IntakeScreen({ projectId, mode = "guided", siteId }: { projectId: string; mode?: IntakeMode; siteId?: string }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const consultant = useConsultant();
  if (!ready || !consultant) return <p role="status">Loading intake…</p>;
  return <IntakeForm projectId={projectId} mode={mode} siteId={siteId} conversation={consultant.conversation} />;
}

/** Wording, placement and the "edits still work" note for the form's own requests. */
const formSend: SendOptions = { source: "page", copy: formCopy, suffix: "Your profile edits still work." };

/**
 * HAC-143: the form keeps no conversation state of its own. History, the request queue,
 * the availability probe and failures are the consultant shell's (one per project); live
 * chat and voice happen in the consultant dock. The form adds structured edits, the offline
 * fixture's prompt-by-prompt answers and, while it is open, prompt-guarded voice answers.
 */
function IntakeForm({ projectId, mode, siteId, conversation }: { projectId: string; mode: IntakeMode; siteId?: string; conversation: IntakeConversation }) {
  const { read, save, enqueue, sendNow, syncEdits, report, busy, storageError } = conversation;
  const session = conversation.session ?? sessionOrInitial(null);
  const live = conversation.availability === "live";
  const failure = conversation.failure?.source === "page" ? conversation.failure : null;
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<Key, string>>>({});
  const missing = missingFields(session.profile);
  const next = missing[0];
  const readiness = intakeReadiness(session, drafts);

  const sync = () => syncEdits(formSend);
  const currentPrompt = () => missingFields(read().profile)[0]?.label ?? "Review your profile";

  /** Typed fixture answers and spoken answers share the project's one action queue. */
  function submitMessage(raw: string, expectedPrompt?: string): Promise<string | null> {
    const text = raw.trim();
    if (!text) return Promise.resolve(null);
    if (live) {
      // Checked before sending: a spoken answer must not land on a prompt that has moved on.
      return enqueue(async () => {
        if (expectedPrompt !== undefined && expectedPrompt !== currentPrompt()) {
          report("Your intake changed before this voice answer could be applied. Please repeat it or keep typing.", "page");
          return null;
        }
        return sendNow(text, true, formSend);
      });
    }
    return enqueue(async () => {
      if (expectedPrompt !== undefined && expectedPrompt !== currentPrompt()) {
        report("Your intake changed before this voice answer could be applied. Please repeat it or keep typing.", "page");
        return null;
      }
      const current = read();
      const prompt = missingFields(current.profile)[0];
      const updated = answerPrompt(current, text);
      if (updated === current || updated.messages.length <= current.messages.length) return null;
      if (prompt && updated.profile !== current.profile) setDrafts(drafts => ({ ...drafts, [prompt.key]: undefined }));
      save(updated);
      return updated.messages.at(-1)?.role === "agent" ? updated.messages.at(-1)!.text : null;
    });
  }

  // HAC-143: the dock's one voice session answers the form's current prompt while it is open.
  useConsultantVoice({
    readContext: () => ({ projectId, mode: "intake", view: conversation.view, prompt: currentPrompt().slice(0, VOICE_LIMITS.promptChars) }),
    submitTranscript: text => submitMessage(text, currentPrompt()),
  });

  const assumptions = session.live ? assumptionRows(session.live.state.assumptions) : [];
  const storageAlert = storageError && <p role="alert" className="mb-4 text-sm">This browser could not save your changes.</p>;

  if (mode === "guided") {
    /** HAC-127: a confirmed guided answer takes the same save path as a profile-field edit. */
    const commit = (key: Key, value: string) => {
      const current = read();
      save(editIntakeField(current, key, value, live));
      sync();
    };
    return (
      <>
        {storageAlert}
        <OnboardingFlow
          profile={session.profile}
          onCommit={commit}
          formHref={intakeHref(projectId, "form", siteId)}
          nextHref={flowStepHref(projectId, "locations")}
          onNext={() => updateFlowState(projectId, (state) => reachStep(state, "locations"))}
          notice={failure && (
            <div role="alert" className="mt-4 rounded-xl border border-white/25 bg-black/30 p-3 text-sm">
              <p>{failure.message}</p>
              {failure.retry !== undefined && (
                <button type="button" className="mt-2 rounded-full border border-white/40 px-3 py-1" disabled={busy}
                  onClick={conversation.retry}>Retry</button>
              )}
            </div>
          )}
        />
      </>
    );
  }

  return (
    <>
      {storageAlert}
      <p className="mb-6 text-sm">
        <Link className="font-semibold text-pine underline" href={intakeHref(projectId, "guided", siteId)}>Back to guided setup</Link>
      </p>
      <div className="grid items-start gap-8 md:grid-cols-2">
        <section aria-labelledby="chat-heading">
          <h2 id="chat-heading" className="text-lg font-semibold">Intake conversation</h2>
          <p className="mt-1 text-sm text-muted">
            {live ? "Live intake agent. Answers are kept in this browser." : "This conversation uses a fixture."}
          </p>
          <ol role="list" aria-live="polite" aria-label="Conversation" tabIndex={0} className="my-4 max-h-96 space-y-3 overflow-y-auto">
            {session.messages.map((entry, index) => (
              <li key={index} className={entry.role === "founder" ? "ml-5 rounded-xl bg-mint p-3" : "mr-5 rounded-xl bg-paper p-3"}>
                <span className="block text-xs font-semibold">{entry.role === "founder" ? "You" : "Intake"}</span>
                {entry.role === "founder" ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.text}</p>
                ) : (
                  <Markdown text={entry.text} className="mt-1 break-words text-sm" />
                )}
              </li>
            ))}
          </ol>
          {failure && (
            <div role="alert" className="mb-3 rounded-lg border border-line bg-paper p-3 text-sm">
              <p>{failure.message}</p>
              {failure.retry !== undefined && (
                <button type="button" className="mt-2 rounded-lg border border-line px-3 py-1" disabled={busy}
                  onClick={conversation.retry}>Retry</button>
              )}
            </div>
          )}
          {live ? (
            <p className="text-sm text-muted">
              Message the intake agent in the BizBox assistant, by text or voice. Replies appear here and in the assistant.
            </p>
          ) : (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            void submitMessage(message);
            setMessage("");
          }}>
            <label className="block text-sm font-medium" htmlFor={next ? "intake-message" : undefined}>
              {next ? `Your answer · ${next.label}` : "Form fields are filled"}
            </label>
            {next && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input id="intake-message" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2"
                  value={message} onChange={(event) => setMessage(event.target.value)} required />
                <button type="submit" className="rounded-lg bg-pine px-4 py-2 text-white">Send</button>
              </div>
            )}
          </form>
          )}
        </section>
        <section aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="text-lg font-semibold">Business profile</h2>
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            {readiness.message}
          </p>
          <div className="mt-5 grid gap-4">
            {fields.map((field) => {
              const answer = session.profile[field.key];
              const draft = drafts[field.key];
              const error = draft === undefined ? undefined : profileValidationMessage(field, draft);
              const errorId = `profile-${field.key}-error`;
              const value = draft ?? answer?.value ?? "";
              const changed = (input: string) => {
                const invalid = profileValidationMessage(field, input);
                setDrafts((current) => ({ ...current, [field.key]: invalid ? input : undefined }));
                if (!invalid) {
                  const current = read();
                  save(editIntakeField(current, field.key, input, live));
                }
              };
              const inputClass = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm";
              return (
                <div key={field.key}>
                  <label htmlFor={`profile-${field.key}`} className="text-sm font-medium">{field.label}</label>
                  {answer?.origin === "default" && <span className="ml-2 rounded bg-mint px-2 py-0.5 text-xs">Default</span>}
                  {"options" in field ? (
                    <select className={inputClass} id={`profile-${field.key}`} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => changed(event.target.value)} onBlur={sync}>
                      <option value="">Select an option</option>
                      {field.options.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input className={inputClass} type={"numeric" in field ? "number" : "text"}
                      min={"numeric" in field ? (field.key === "staff" ? 1 : 0) : undefined}
                      step={"numeric" in field ? 1 : undefined}
                      id={`profile-${field.key}`} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => changed(event.target.value)} onBlur={sync} />
                  )}
                  {error && <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-danger">{error}</p>}
                </div>
              );
            })}
          </div>
          {session.live && (
            <div className="mt-6 space-y-4">
              {assumptions.length > 0 && (
                <section aria-labelledby="assumptions-heading">
                  <h3 id="assumptions-heading" className="text-sm font-semibold">Assumptions</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {assumptions.map((row) => (
                      <li key={row.key}>
                        {row.label}: {row.value}{" "}
                        <span className="ml-1 rounded bg-mint px-2 py-0.5 text-xs">{row.origin === "founder" ? "Founder" : row.origin === "default" ? "Default" : "Mixed"}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {session.live.missingRequiredFields.length > 0 && (
                <p className="text-sm">Agent still needs: {session.live.missingRequiredFields.join(", ")}.</p>
              )}
              {session.live.findings.length > 0 && (
                <section aria-labelledby="findings-heading">
                  <h3 id="findings-heading" className="text-sm font-semibold">Findings</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {session.live.findings.map((finding) => <li key={finding}>{finding}</li>)}
                  </ul>
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
