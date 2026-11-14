"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type {
  WorkspaceObservation,
  WorkspaceReport,
} from "./workspace-context";

export type WorkspacePublisher = (
  source: string,
  report: WorkspaceReport | null,
) => void;
export const WorkspacePublicationContext =
  createContext<WorkspacePublisher | null>(null);

/** Optional observer: existing screens continue to work without a project provider. */
export function useWorkspaceReport(
  projectId: string,
  observation: WorkspaceObservation,
) {
  const publish = useContext(WorkspacePublicationContext);
  const source = useId();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (!publish) return;
    publish(source, {
      projectId,
      routeKey: `${pathname}?${search}`,
      observation,
    });
    return () => publish(source, null);
  }, [publish, source, projectId, pathname, search, observation]);
}

export function useContextIntake(projectId: string) {
  const key = `sitework:intake:v1:${projectId}`;
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const subscribe = useCallback(
    (refresh: () => void) => {
      const storage = (event: StorageEvent) => {
        if (!event.key || event.key === key) refresh();
      };
      window.addEventListener("storage", storage);
      // Input/submit bubble after the existing intake React handlers save locally.
      // This observes same-tab edits without changing intake persistence or polling.
      const events = ["focus", "input", "change", "submit"] as const;
      events.forEach((event) => window.addEventListener(event, refresh));
      return () => {
        window.removeEventListener("storage", storage);
        events.forEach((event) => window.removeEventListener(event, refresh));
      };
    },
    [key],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
