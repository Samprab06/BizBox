"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspaceReport } from "./use-workspace-context";
import type { WorkspaceObservation } from "./workspace-context";
import type { BusinessProfile } from "@/lib/contracts";
import {
  SiteSearchResultSchema,
  type SiteSearchResult,
} from "@/lib/contracts/sites";
import { profileFromIntake } from "./intake-business-profile";

type SearchState =
  | { mode: "loading" }
  | { mode: "example"; message: string; failed: boolean; notes: string[] }
  | {
      mode: "live";
      result: SiteSearchResult;
      profile: BusinessProfile;
      notes: string[];
    };

/** Browser intake is local to this device; search never claims to persist a project. */
export function useSiteSearch(projectId: string, revision = 0) {
  const [state, setState] = useState<SearchState>({ mode: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    async function load() {
      let raw: unknown = null;
      let storageMessage: string | null = null;
      try {
        raw = JSON.parse(
          localStorage.getItem(`sitework:intake:v1:${projectId}`) ?? "null",
        );
      } catch {
        storageMessage =
          "Saved intake could not be read. Complete or review your intake to search live listings.";
      }
      const converted = profileFromIntake(raw, projectId);
      if (!converted.profile) {
        if (!disposed)
          setState({
            mode: "example",
            message:
              storageMessage ??
              converted.reason ??
              "Complete your intake to search live listings.",
            failed: false,
            notes: converted.notes,
          });
        return;
      }
      try {
        const response = await fetch("/api/sites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: converted.profile, limit: 8 }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("search unavailable");
        const result = SiteSearchResultSchema.parse(await response.json());
        if (
          result.candidates.some(
            ({ candidate }) => candidate.projectId !== projectId,
          )
        )
          throw new Error("Search identity mismatch");
        if (!disposed)
          setState({
            mode: "live",
            result,
            profile: converted.profile,
            notes: converted.notes,
          });
      } catch {
        if (!disposed)
          setState({
            mode: "example",
            message:
              "Candidate search unavailable. Showing examples while the listing service is unavailable.",
            failed: true,
            notes: converted.notes,
          });
      }
    }
    void load().finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, attempt, revision]);
  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "search",
      phase: state.mode,
      candidates:
        state.mode === "live"
          ? state.result.candidates.map((entry) => entry.candidate)
          : [],
      evidenceId:
        state.mode === "live" ? state.result.evidence[0]?.id : undefined,
    }),
    [state],
  );
  useWorkspaceReport(projectId, context);
  return {
    state,
    retry: () => {
      setState({ mode: "loading" });
      setAttempt((value) => value + 1);
    },
  };
}
