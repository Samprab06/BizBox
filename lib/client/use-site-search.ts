"use client";

import { useEffect, useMemo, useState } from "react";
import { useContextIntake, useWorkspaceReport } from "./use-workspace-context";
import type { WorkspaceObservation } from "./workspace-context";
import type { BusinessProfile } from "@/lib/contracts";
import {
  SiteSearchResultSchema,
  type SiteSearchResult,
} from "@/lib/contracts/sites";
import { profileFromIntake } from "./intake-business-profile";

/** Additive client readiness; legacy consumers retain the loading/example/live modes. */
export type NeedsBrief = { status: "needs_brief"; message: string };

export type SiteSearchReadiness =
  | NeedsBrief
  | { status: "loading" | "error"; message: string }
  | {
      status: "empty" | "ready";
      message: string;
      profile: BusinessProfile;
      filters: SiteSearchResult["filters"];
      mostRestrictiveFilter: string | null;
      emptyReason: string | null;
      totalMatched: number;
      notes: string[];
    };

export type SiteSearchState =
  | { mode: "loading" }
  | {
      mode: "example";
      reason: "needs_brief" | "error";
      message: string;
      failed: boolean;
      notes: string[];
    }
  | {
      mode: "live";
      result: SiteSearchResult;
      profile: BusinessProfile;
      notes: string[];
    };

const LOADING: SiteSearchState = { mode: "loading" };

/** Only founder criteria drive inventory requests; chat history does not. */
export function searchBriefSnapshot(raw: string | null): string {
  try {
    const session: unknown = JSON.parse(raw ?? "null");
    const profile =
      session && typeof session === "object" && "profile" in session
        ? session.profile
        : null;
    return JSON.stringify({ profile, messages: [] });
  } catch {
    return "null";
  }
}

/** Actual saved intake → existing inventory endpoint. Never widens or seeds the criteria. */
export async function loadSiteSearch(
  rawSession: unknown,
  projectId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Exclude<SiteSearchState, { mode: "loading" }>> {
  const converted = profileFromIntake(rawSession, projectId);
  if (!converted.profile)
    return {
      mode: "example",
      reason: "needs_brief",
      message: converted.reason ?? "Complete your brief to search listings.",
      failed: false,
      notes: converted.notes,
    };
  try {
    const response = await fetcher("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: converted.profile, limit: 8 }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Listing service unavailable");
    const result = SiteSearchResultSchema.parse(await response.json());
    if (
      result.candidates.some(
        ({ candidate }) => candidate.projectId !== projectId,
      )
    )
      throw new Error("Search identity mismatch");
    return {
      mode: "live",
      result,
      profile: converted.profile,
      notes: converted.notes,
    };
  } catch {
    return {
      mode: "example",
      reason: "error",
      message: "Listings could not be loaded. Retry your search.",
      failed: true,
      notes: converted.notes,
    };
  }
}

export function siteSearchReadiness(
  state: SiteSearchState,
): SiteSearchReadiness {
  if (state.mode === "loading")
    return { status: "loading", message: "Finding spaces…" };
  if (state.mode === "example")
    return { status: state.reason, message: state.message };
  if (
    state.result.candidates.length > 0 &&
    state.result.candidates.every(({ candidate }) => candidate.synthetic)
  )
    return {
      status: "error",
      message:
        "Verified listings are unavailable. Example properties are not shown here.",
    };
  return {
    status: state.result.candidates.length ? "ready" : "empty",
    message: state.result.candidates.length
      ? "Listings loaded"
      : "No matching spaces",
    profile: state.profile,
    filters: state.result.filters,
    mostRestrictiveFilter: state.result.mostRestrictiveFilter,
    emptyReason: state.result.emptyReason,
    totalMatched: state.result.totalMatched,
    notes: state.notes,
  };
}

/** Browser intake is local to this device; search never claims to persist a project. */
export function useSiteSearch(projectId: string, revision = 0) {
  // This existing observer handles same-tab INTAKE_UPDATED_EVENT and cross-tab edits.
  const raw = useContextIntake(projectId);
  const brief = useMemo(() => searchBriefSnapshot(raw), [raw]);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([projectId, brief, revision, attempt]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    value: SiteSearchState;
  }>({ key: "", value: LOADING });
  // Hide old criteria immediately, before the effect or a previous request can settle.
  const state = snapshot.key === requestKey ? snapshot.value : LOADING;

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void loadSiteSearch(JSON.parse(brief), projectId, fetch, controller.signal)
      .then((value) => {
        if (!disposed) setSnapshot({ key: requestKey, value });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, brief, requestKey]);

  const readiness = useMemo(() => siteSearchReadiness(state), [state]);
  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "search",
      phase: state.mode,
      needsBrief: readiness.status === "needs_brief",
      candidates:
        state.mode === "live"
          ? state.result.candidates.map((entry) => entry.candidate)
          : [],
      evidenceId:
        state.mode === "live" ? state.result.evidence[0]?.id : undefined,
    }),
    [readiness.status, state],
  );
  useWorkspaceReport(projectId, context);
  return {
    state,
    readiness,
    retry: () => setAttempt((value) => value + 1),
  };
}
