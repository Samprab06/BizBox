"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INTAKE_UPDATED_EVENT } from "@/lib/client/intake-events";
import { useContextIntake } from "@/lib/client/use-workspace-context";
import {
  applyIntakeReply,
  intakeEndpoint,
  intakeRequestBody,
  intakeStorageKey,
  parseIntakeSession,
  postIntakeMessage,
  sessionOrInitial,
  withFounderMessage,
} from "./intake-conversation";

export type AgentAvailability = "checking" | "live" | "offline";
export type ConversationFailure = { message: string; retry?: string };

/** Same capability probe as the intake screen: live only when the server reports a model. */
function useAgentAvailability(projectId: string): AgentAvailability {
  const [state, setState] = useState<AgentAvailability>("checking");
  useEffect(() => {
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
  }, [projectId]);
  return state;
}

/**
 * The workspace assistant's conversation: the existing intake session, observed through the
 * existing `useContextIntake` store hook and updated only through the intake agent's reply.
 * Text and voice both call `submit`, so they share one history and one request queue.
 */
export function useIntakeConversation(projectId: string) {
  const key = intakeStorageKey(projectId);
  const raw = useContextIntake(projectId);
  const session = useMemo(() => parseIntakeSession(raw), [raw]);
  const availability = useAgentAvailability(projectId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);
  const [storageError, setStorageError] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(() => {
    try {
      return sessionOrInitial(localStorage.getItem(key));
    } catch {
      return sessionOrInitial(null);
    }
  }, [key]);

  const save = useCallback(
    (next: ReturnType<typeof read>) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(
          new CustomEvent(INTAKE_UPDATED_EVENT, { detail: { key } }),
        );
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    },
    [key],
  );

  const send = useCallback(
    async (text: string, appendFounder: boolean): Promise<string | null> => {
      const current = read();
      const body = intakeRequestBody(current, text);
      if (appendFounder) save(withFounderMessage(current, text));
      setBusy(true);
      setFailure(null);
      try {
        const outcome = await postIntakeMessage(fetch, projectId, body);
        if (!mounted.current) return null;
        if (!outcome.ok) {
          setFailure({
            message: outcome.message,
            retry: outcome.retryable ? text : undefined,
          });
          return null;
        }
        save(applyIntakeReply(read(), current, outcome.result));
        return outcome.result.assistantMessage;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [projectId, read, save],
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

  /** Sends a typed or spoken message; resolves to the agent's actual reply, or null. */
  const submit = useCallback(
    (raw: string): Promise<string | null> => {
      const text = raw.trim();
      if (!text) return Promise.resolve(null);
      if (availability !== "live") {
        setFailure({
          message:
            "The BizBox assistant is offline, so nothing was sent. Edit your brief in Intake instead.",
        });
        return Promise.resolve(null);
      }
      return enqueue(() => send(text, true));
    },
    [availability, enqueue, send],
  );

  const retry = useCallback(() => {
    const text = failure?.retry;
    if (text === undefined) return;
    void enqueue(() => send(text, false));
  }, [enqueue, failure, send]);

  return {
    session,
    messages: session?.messages ?? [],
    availability,
    busy,
    failure,
    storageError,
    submit,
    retry,
  };
}

export type IntakeConversation = ReturnType<typeof useIntakeConversation>;
