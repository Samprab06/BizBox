"use client";

import { INTAKE_UPDATED_EVENT } from "@/lib/client/intake-events";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { VoicePanel } from "@/components/voice/voice-panel";
import { workspaceHref } from "@/lib/client/workspace-routes";
import Link from "next/link";
import { useAgentViewContext } from "@/lib/client/use-workspace-context";
import { VOICE_LIMITS, type VoiceAdapter } from "@/lib/voice/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyIntakeReply, intakeRequestBody, postIntakeMessage, withFounderMessage, type IntakeCopy } from "@/components/workspace-screen/intake-conversation";
import { useAssistantDraft } from "@/components/workspace-screen/use-assistant-draft";
import { assumptionRows } from "./live";
import { answerPrompt, fields, initialSession, intakeSessionSchema, missingFields, profileValidationMessage, updateProfile, type IntakeSession } from "./profile";

type Key = (typeof fields)[number]["key"];
type Failure = { message: string; retry?: string };

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
  const key = `sitework:intake:v1:${projectId}`;
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  if (!ready) return <p role="status">Loading intake…</p>;
  return <IntakeForm key={key} storageKey={key} projectId={projectId} mode={mode} siteId={siteId} />;
}

function readSession(key: string): IntakeSession {
  try {
    const saved = localStorage.getItem(key);
    return saved ? intakeSessionSchema.parse(JSON.parse(saved)) : initialSession;
  } catch {
    return initialSession;
  }
}

/** HAC-66: live when the server reports an intake model; otherwise the labelled offline fixture. */
function useLiveIntake(projectId: string) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/intake`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { modelConfigured?: unknown } | null) => {
        if (active) setLive(body?.modelConfigured === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);
  return live;
}

function IntakeForm({ storageKey, projectId, mode, siteId }: { storageKey: string; projectId: string; mode: IntakeMode; siteId?: string }) {
  const view = useAgentViewContext();
  const [session, setSession] = useState(() => readSession(storageKey));
  const [message, setMessage] = useState("");
  // HAC-129: the live composer shares its draft with the workspace assistant.
  const [liveDraft, setLiveDraft] = useAssistantDraft(projectId);
  const [drafts, setDrafts] = useState<Partial<Record<Key, string>>>({});
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const live = useLiveIntake(projectId);
  // The latest session for async callbacks; save() and the storage listener keep it current.
  const latest = useRef(session);
  const requests = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const missing = missingFields(session.profile);
  const next = missing[0];

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const stored = readSession(storageKey);
      latest.current = stored;
      setSession(stored);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  function save(updated: IntakeSession) {
    latest.current = updated;
    setSession(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent(INTAKE_UPDATED_EVENT, { detail: { key: storageKey } }));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  /** Sends the founder's message (or only pending form edits) with the round-tripped state. */
  function enqueue(action: () => Promise<string | null>): Promise<string | null> {
    const result = requests.current.then(() => mounted.current ? action() : null);
    requests.current = result.catch(() => null);
    return result;
  }

  function send(text: string | undefined, appendFounder: boolean): Promise<string | null> {
    return enqueue(() => sendLive(text, appendFounder));
  }

  async function sendLive(text: string | undefined, appendFounder: boolean): Promise<string | null> {
    const current = latest.current;
    const body = intakeRequestBody(current, text, view, projectId);
    if (!text && !body.patch) return null;
    save(appendFounder && text ? withFounderMessage(current, text) : current);
    setBusy(true);
    setFailure(null);
    try {
      // HAC-129: the request and reply merge are the workspace assistant's own functions.
      const outcome = await postIntakeMessage(fetch, projectId, body, formCopy);
      if (!mounted.current) return null;
      if (!outcome.ok) {
        setFailure({
          message: `${outcome.message} Your profile edits still work.`,
          retry: outcome.retryable ? text ?? "" : undefined,
        });
        return null;
      }
      save(applyIntakeReply(latest.current, current, outcome.result, Boolean(text)));
      return outcome.result.assistantMessage;
    } finally {
      setBusy(false);
    }
  }

  /** Sends committed form edits as a structured patch; no model call is needed. */
  function sync() {
    // A pending retry carries these edits with it, so it is not pre-empted.
    if (live && !busy && failure?.retry === undefined && latest.current.pending?.length) void send(undefined, false);
  }

  const currentPrompt = () => missingFields(latest.current.profile)[0]?.label ?? "Review your profile";

  /** Typed and spoken messages share this existing-state action queue. */
  function submitMessage(raw: string, expectedPrompt?: string): Promise<string | null> {
    const text = raw.trim();
    if (!text) return Promise.resolve(null);
    return enqueue(async () => {
      if (expectedPrompt !== undefined && expectedPrompt !== currentPrompt()) {
        setFailure({ message: "Your intake changed before this voice answer could be applied. Please repeat it or keep typing." });
        return null;
      }
      if (live) return sendLive(text, true);
      const current = latest.current;
      const prompt = missingFields(current.profile)[0];
      const updated = answerPrompt(current, text);
      if (updated === current || updated.messages.length <= current.messages.length) return null;
      if (prompt && updated.profile !== current.profile) setDrafts(drafts => ({ ...drafts, [prompt.key]: undefined }));
      save(updated);
      return updated.messages.at(-1)?.role === "agent" ? updated.messages.at(-1)!.text : null;
    });
  }

  const voiceAdapter: VoiceAdapter = {
    readContext: () => ({ projectId, mode: "intake", view, prompt: currentPrompt().slice(0, VOICE_LIMITS.promptChars) }),
    submitTranscript: text => submitMessage(text, currentPrompt()),
  };

  const assumptions = session.live ? assumptionRows(session.live.state.assumptions) : [];
  const storageAlert = storageError && <p role="alert" className="mb-4 text-sm">This browser could not save your changes.</p>;

  if (mode === "guided") {
    /** HAC-127: a confirmed guided answer takes the same save path as a profile-field edit. */
    const commit = (key: Key, value: string) => {
      const current = latest.current;
      const pending = live ? [...new Set([...(current.pending ?? []), key])] : current.pending;
      save({ ...current, profile: updateProfile(current.profile, key, value), pending });
      sync();
    };
    return (
      <>
        {storageAlert}
        <OnboardingFlow
          profile={session.profile}
          onCommit={commit}
          formHref={intakeHref(projectId, "form", siteId)}
          nextHref={workspaceHref(projectId, "workspace", siteId)}
          notice={failure && (
            <div role="alert" className="mt-4 rounded-xl border border-white/25 bg-black/30 p-3 text-sm">
              <p>{failure.message}</p>
              {failure.retry !== undefined && (
                <button type="button" className="mt-2 rounded-full border border-white/40 px-3 py-1" disabled={busy}
                  onClick={() => void send(failure.retry || undefined, false)}>Retry</button>
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
                <p className="mt-1 break-words text-sm">{entry.text}</p>
              </li>
            ))}
          </ol>
          {failure && (
            <div role="alert" className="mb-3 rounded-lg border border-line bg-paper p-3 text-sm">
              <p>{failure.message}</p>
              {failure.retry !== undefined && (
                <button type="button" className="mt-2 rounded-lg border border-line px-3 py-1" disabled={busy}
                  onClick={() => void send(failure.retry || undefined, false)}>Retry</button>
              )}
            </div>
          )}
          <VoicePanel adapter={voiceAdapter} />
          {live ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              const text = liveDraft.trim();
              if (!text || busy) return;
              setLiveDraft("");
              void submitMessage(text);
            }}>
              <label className="block text-sm font-medium" htmlFor="intake-live-message">Message the intake agent</label>
              <div className="mt-2 flex flex-wrap gap-2">
                <input id="intake-live-message" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2"
                  value={liveDraft} onChange={(event) => setLiveDraft(event.target.value)} required />
                <button type="submit" disabled={busy} className="rounded-lg bg-pine px-4 py-2 text-white disabled:opacity-60">
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            void submitMessage(message);
            setMessage("");
          }}>
            <label className="block text-sm font-medium" htmlFor={next ? "intake-message" : undefined}>
              {next ? `Your answer · ${next.label}` : "Your profile is complete"}
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
            {missing.length ? `Still needed: ${missing.map((field) => field.label).join(", ")}.` : "All required fields are filled."}
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
                  const current = latest.current;
                  const pending = live ? [...new Set([...(current.pending ?? []), field.key])] : current.pending;
                  save({ ...current, profile: updateProfile(current.profile, field.key, input), pending });
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
                  {error && <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-red-800">{error}</p>}
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
