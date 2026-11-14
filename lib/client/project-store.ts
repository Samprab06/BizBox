"use client";

import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * HAC-135: the small client project store. It keeps the state a founder builds up in a
 * project (the saved comparison and the comparison shortlist) in localStorage, so it
 * survives navigation, and resolves it against the URL (`?comparison=` wins). Every
 * screen that needs the saved comparison reads it from here instead of only the URL.
 */

const SavedSchema = z.object({
  projectId: z.string(),
  comparisonId: z.string().min(1),
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  intakeFingerprint: z.string(),
});
export type SavedComparison = z.infer<typeof SavedSchema>;

export const comparisonStorageKey = (projectId: string) =>
  `sitework:comparison:v1:${projectId}`;
export const shortlistStorageKey = (projectId: string) =>
  `sitework:shortlist:v1:${projectId}`;

/** Same-tab writes don't fire `storage`, so the store announces them with this event. */
const CHANGE_EVENT = "sitework:project-store";

/** A single `?comparison=` in `href` wins; otherwise the saved comparison. */
export function activeComparisonId(
  href: string,
  saved: SavedComparison | null,
) {
  const ids = new URL(href).searchParams.getAll("comparison");
  return (ids.length === 1 && ids[0]) || saved?.comparisonId;
}

export function readSavedComparison(
  storage: Pick<Storage, "getItem">,
  projectId: string,
): SavedComparison | null {
  try {
    const saved = SavedSchema.parse(
      JSON.parse(storage.getItem(comparisonStorageKey(projectId)) ?? "null"),
    );
    return saved.projectId === projectId ? saved : null;
  } catch {
    return null;
  }
}

function announce(key: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
}

export function writeSavedComparison(saved: SavedComparison) {
  try {
    localStorage.setItem(
      comparisonStorageKey(saved.projectId),
      JSON.stringify(saved),
    );
  } catch {
    /* Explicit ?comparison= links still work when storage is unavailable. */
  }
  announce(comparisonStorageKey(saved.projectId));
}

const ShortlistSchema = z.array(z.string().min(1)).max(8);

export function readShortlist(
  storage: Pick<Storage, "getItem">,
  projectId: string,
): string[] | null {
  try {
    const parsed = ShortlistSchema.safeParse(
      JSON.parse(storage.getItem(shortlistStorageKey(projectId)) ?? "null"),
    );
    return parsed.success ? [...new Set(parsed.data)] : null;
  } catch {
    return null;
  }
}

export function writeShortlist(projectId: string, ids: string[]) {
  try {
    localStorage.setItem(
      shortlistStorageKey(projectId),
      JSON.stringify(ids.slice(0, 8)),
    );
  } catch {
    /* The shortlist then lasts only for this visit. */
  }
}

/**
 * The shortlist to show for the current candidates: the saved shortlist (kept in candidate
 * order) when one exists, otherwise every candidate. A saved empty shortlist stays empty.
 */
export function restoreShortlist(
  saved: string[] | null,
  candidateIds: string[],
) {
  if (!saved) return candidateIds;
  return candidateIds.filter((id) => saved.includes(id));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The comparison this project should open: `?comparison=` (or `urlComparisonId`), else the
 * saved one. `undefined` until the client has hydrated (the server can't read storage),
 * then the id, or `null` when there is none.
 */
export function useProjectComparisonId(
  projectId: string,
  urlComparisonId?: string,
): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (urlComparisonId) return urlComparisonId;
      let saved: SavedComparison | null = null;
      try {
        saved = readSavedComparison(localStorage, projectId);
      } catch {
        /* Storage blocked: only the URL can name a comparison. */
      }
      return activeComparisonId(window.location.href, saved) ?? null;
    },
    () => urlComparisonId,
  );
}

/**
 * For server-rendered pages that can only read `?comparison=` (the simulator): when the URL
 * has none but the project has a saved comparison, replace the URL with one that names it,
 * so the server loads the saved run instead of the example.
 */
export function RestoreSavedComparison({
  projectId,
}: {
  projectId: string;
}): null {
  const comparisonId = useProjectComparisonId(projectId);
  useEffect(() => {
    if (!comparisonId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("comparison")) return;
    url.searchParams.set("comparison", comparisonId);
    // A full replace (not a soft navigation) so the server renders the stored run, and the
    // bare URL leaves no history entry to bounce back through.
    window.location.replace(url);
  }, [comparisonId]);
  return null;
}
