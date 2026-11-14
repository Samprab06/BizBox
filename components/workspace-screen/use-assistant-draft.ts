"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * HAC-129: the unsent assistant message, kept for the tab so it survives navigating to
 * Edit brief and back, Back/forward and a reload. It is only the composer's text: the
 * conversation itself and the founder's profile stay in the one intake session, and a draft
 * is never sent or saved as a profile field until the founder submits it.
 */
export const assistantDraftKey = (projectId: string) =>
  `bizbox:assistant-draft:v1:${projectId}`;

function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the draft just lasts until the page changes.
  }
}

export function useAssistantDraft(projectId: string) {
  const key = assistantDraftKey(projectId);
  const [draft, setDraftState] = useState("");
  const hydrated = useRef(false);

  useEffect(() => {
    // Read after mount so the server render and first client render agree.
    const saved = readDraft(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDraftState(saved);
    hydrated.current = true;
  }, [key]);

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      if (hydrated.current) writeDraft(key, value);
    },
    [key],
  );

  return [draft, setDraft] as const;
}
