"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntakeSession } from "@/components/intake/profile";
import type { FlowEvent, UiAction } from "@/lib/contracts/agent";
import { INTAKE_UPDATED_EVENT } from "@/lib/client/intake-events";
import {
  useAgentViewContext,
  useContextIntake,
} from "@/lib/client/use-workspace-context";
import {
  applyIntakeReply,
  assistantCopy,
  flowEventRequestBody,
  intakeEndpoint,
  intakeRequestBody,
  intakeStorageKey,
  parseIntakeSession,
  postIntakeMessage,
  sessionOrInitial,
  withFounderMessage,
  type IntakeCopy,
} from "./intake-conversation";

export type AgentAvailability = "checking" | "live" | "offline";
/**
 * Where a failure is shown. `assistant`: the consultant dock (typed or default voice
 * messages). `page`: the screen that started the request (the intake form's structured
 * edits and its prompt-guarded voice answers), so one failure never shows two alerts.
 */
export type FailureSource = "assistant" | "page";
export type ConversationFailure = {
  message: string;
  /** The message to resend; "" retries a form-only sync of pending edits. */
  retry?: string;
  source: FailureSource;
};
export type SendOptions = {
  source?: FailureSource;
  copy?: IntakeCopy;
  /** Appended to the failure message, e.g. "Your profile edits still work." */
  suffix?: string;
};

/**
 * Live only when the server reports a model. HAC-143: the probe runs once per project
 * shell; an offline (or unanswered) result is checked again when the founder moves to
 * another step, so a model configured meanwhile is picked up without a reload.
 */
function useAgentAvailability(projectId: string): AgentAvailability {
  const [state, setState] = useState<AgentAvailability>("checking");
  const pathname = usePathname();
  const live = state === "live";
  useEffect(() => {
    if (live) return;
    let active = true;
    fetch(intakeEndpoint(projectId), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { modelConfigured?: unknown } | null) => {
        if (active)
          setState(body?.modelConfigured === true ? "live" : "offline");
      })
      .catch(() => {
        if (active) setState("offline");
      });
    return () => {
      active = false;
    };
  }, [projectId, pathname, live]);
  return state;
}

/**
 * The project's one conversation: the existing intake session, observed through the
 * existing `useContextIntake` store hook and updated only through the intake agent's reply.
 *
 * HAC-143: the consultant shell mounts this once in the project layout, so the busy state,
 * failure, request queue and availability probe survive client navigation. The dock's text
 * and voice input and the intake screen's form (structured edits, offline fixture answers)
 * all go through `enqueue`, so there is one queue per project.
 */
export function useIntakeConversation(
  projectId: string,
  /** HAC-150: told of the UI actions on each successful reply (the shell watches for `navigate`). */
  onActions?: (actions: UiAction[]) => void,
) {
  const view = useAgentViewContext();
  const actionsRef = useRef(onActions);
  useEffect(() => {
    actionsRef.current = onActions;
  }, [onActions]);
  const key = intakeStorageKey(projectId);
  const raw = useContextIntake(projectId);
  const availability = useAgentAvailability(projectId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);
  const [storageError, setStorageError] = useState(false);
  // When localStorage refuses a write, the session lives here until the page reloads.
  const [unsaved, setUnsaved] = useState<IntakeSession | null>(null);
  const unsavedRef = useRef<IntakeSession | null>(null);
  const session = useMemo(
    () => unsaved ?? parseIntakeSession(raw),
    [raw, unsaved],
  );
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** The latest session, read synchronously so queued actions never act on stale state. */
  const read = useCallback((): IntakeSession => {
    if (unsavedRef.current) return unsavedRef.current;
    try {
      return sessionOrInitial(localStorage.getItem(key));
    } catch {
      return sessionOrInitial(null);
    }
  }, [key]);

  const save = useCallback(
    (next: IntakeSession) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
        unsavedRef.current = null;
        setUnsaved(null);
        setStorageError(false);
      } catch {
        unsavedRef.current = next;
        setUnsaved(next);
        setStorageError(true);
      }
      window.dispatchEvent(
        new CustomEvent(INTAKE_UPDATED_EVENT, { detail: { key } }),
      );
    },
    [key],
  );

  // Another tab's write replaces an unsaved in-memory session.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== key || !unsavedRef.current) return;
      unsavedRef.current = null;
      setUnsaved(null);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  /**
   * Posts the founder's message (or, with no text, only pending form edits) with the
   * round-tripped state, then merges the reply. Resolves to the agent's reply, or null.
   */
  const send = useCallback(
    async (
      text: string | undefined,
      appendFounder: boolean,
      options: SendOptions = {},
    ): Promise<string | null> => {
      const source = options.source ?? "assistant";
      const current = read();
      const body = intakeRequestBody(current, text, view, projectId);
      if (!text && !body.patch) return null;
      if (appendFounder && text) save(withFounderMessage(current, text));
      setBusy(true);
      setFailure(null);
      try {
        const outcome = await postIntakeMessage(
          fetch,
          projectId,
          body,
          options.copy ?? assistantCopy,
        );
        if (!mounted.current) return null;
        if (!outcome.ok) {
          setFailure({
            message: options.suffix
              ? `${outcome.message} ${options.suffix}`
              : outcome.message,
            retry: outcome.retryable ? (text ?? "") : undefined,
            source,
          });
          return null;
        }
        save(applyIntakeReply(read(), current, outcome.result, Boolean(text)));
        if (outcome.result.actions?.length)
          actionsRef.current?.(outcome.result.actions);
        return outcome.result.assistantMessage;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [projectId, read, save, view],
  );

  const enqueue = useCallback(
    (action: () => Promise<string | null>): Promise<string | null> => {
      const result = queue.current.then(() =>
        mounted.current ? action() : null,
      );
      queue.current = result.catch(() => null);
      return result;
    },
    [],
  );

  // The options of the request that failed, so Retry reports in the same place.
  const lastOptions = useRef<SendOptions>({});
  /** Sends immediately; only call it from inside an `enqueue`d action. */
  const sendNow = useCallback(
    (text: string | undefined, appendFounder: boolean, options: SendOptions) => {
      lastOptions.current = options;
      return send(text, appendFounder, options);
    },
    [send],
  );
  const sendWith = useCallback(
    (text: string | undefined, appendFounder: boolean, options: SendOptions) =>
      enqueue(() => sendNow(text, appendFounder, options)),
    [enqueue, sendNow],
  );

  /** Sends a typed or spoken message; resolves to the agent's actual reply, or null. */
  const submit = useCallback(
    (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (!text) return Promise.resolve(null);
      if (availability !== "live") {
        setFailure({
          message:
            "The BizBox assistant is offline, so nothing was sent. Edit your brief under Your business in the top bar instead.",
          source: "assistant",
        });
        return Promise.resolve(null);
      }
      return sendWith(text, true, {});
    },
    [availability, sendWith],
  );

  const retry = useCallback(() => {
    const text = failure?.retry;
    if (text === undefined) return;
    void sendWith(text || undefined, false, {
      ...lastOptions.current,
      source: failure?.source,
    });
  }, [failure, sendWith]);

  /** Sends committed form edits as a structured patch; no model call is needed. */
  const syncEdits = useCallback(
    (options: SendOptions) => {
      // A pending retry carries these edits with it, so it is not pre-empted.
      if (
        availability === "live" &&
        !busy &&
        failure?.retry === undefined &&
        read().pending?.length
      )
        void sendWith(undefined, false, options);
    },
    [availability, busy, failure, read, sendWith],
  );

  const report = useCallback(
    (message: string, source: FailureSource) =>
      setFailure({ message, source }),
    [],
  );

  // Scene 1: the view is read when the event is sent, not when it was queued.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  /**
   * Scene 1: tells the consultant about something that happened in the browser (arriving in
   * the workspace, a comparison starting, progressing, finishing or failing). Queued with the
   * founder's messages; the reply is appended to the chat and its actions dispatched. It never
   * throws and never shows a failure: an offline consultant just stays quiet.
   */
  const sendEvent = useCallback(
    (event: FlowEvent): Promise<string | null> =>
      enqueue(async () => {
        const body = flowEventRequestBody(read(), event, viewRef.current);
        try {
          const outcome = await postIntakeMessage(fetch, projectId, body);
          if (!mounted.current || !outcome.ok) return null;
          // An event is not founder input, so its reply never edits the brief: only the
          // consultant's message is added (the brief, and every result keyed to it, stay).
          const text = outcome.result.assistantMessage.trim();
          if (text) {
            const now = read();
            save({
              ...now,
              messages: [...now.messages, { role: "agent", text }],
            });
          }
          if (event.kind !== "interior_experiment_finished" && outcome.result.actions?.length)
            actionsRef.current?.(outcome.result.actions);
          return outcome.result.assistantMessage;
        } catch {
          return null;
        }
      }).catch(() => null),
    [enqueue, projectId, read, save],
  );

  return {
    session,
    view,
    messages: session?.messages ?? [],
    availability,
    busy,
    failure,
    storageError,
    read,
    save,
    enqueue,
    submit,
    /** Queues a live send with page-specific wording and failure placement. */
    sendWith,
    sendNow,
    retry,
    syncEdits,
    report,
    sendEvent,
  };
}

export type IntakeConversation = ReturnType<typeof useIntakeConversation>;
