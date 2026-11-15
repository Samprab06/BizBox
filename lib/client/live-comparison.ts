"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useWorkspaceReport } from "./use-workspace-context";
import type { WorkspaceObservation } from "./workspace-context";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import {
  EvaluationResultSchema,
  RobustnessSummarySchema,
  type RobustnessSummary,
  SensitivityResultSchema,
} from "@/lib/contracts/evaluation";
import { profileFromIntake } from "./intake-business-profile";
import { useSiteSearch, type SiteSearchReadiness } from "./use-site-search";
import { INTAKE_UPDATED_EVENT } from "./intake-events";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import type {
  DemandSource,
  EvaluationResult,
  SensitivityAssumption,
  SensitivityResult,
} from "@/lib/contracts/evaluation";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";

export type LiveComparisonPayload = {
  comparisonId: string;
  outdated: boolean;
  result: EvaluationResult;
  robustness?: RobustnessSummary | null;
  assembly?: AssemblyMetadata;
  /** Existing server record provenance, retained for the workspace context. */
  comparison?: { synthetic: boolean };
  /** Huff-only ranking check, returned only for fresh Jev comparisons. */
  demandSourceCheck?: {
    primary: "jev" | "huff";
    primaryRanking: string[];
    huffRanking: string[];
    rankingMatches: boolean;
    topMatches: boolean;
  } | null;
};

export type LiveComparisonController = {
  phase: "loading" | "ready" | "running" | "example";
  candidates: SiteSearchResult["candidates"];
  /** Inventory readiness and real filter metadata; optional for existing consumers. */
  search?: SiteSearchReadiness;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  payload: LiveComparisonPayload | null;
  message: string;
  notes: string[];
  demandSource: DemandSource;
  demandSourceReason: string;
  retry: () => void;
  run: () => Promise<void>;
  sensitivity: {
    loading: boolean;
    result: SensitivityResult | null;
    error: string | null;
  };
  runSensitivity: (assumption: SensitivityAssumption) => Promise<void>;
};

export type StoredComparisonState = {
  phase: "loading" | "ready" | "example";
  payload: LiveComparisonPayload | null;
  message: string;
  retry: () => void;
  failed: boolean;
};

const PayloadSchema = z.object({
  comparisonId: z.string().min(1),
  outdated: z.boolean(),
  result: EvaluationResultSchema,
  comparison: z.object({ synthetic: z.boolean() }).optional(),
  /** HAC-62 headline; null/absent for comparisons stored before it existed. */
  robustness: RobustnessSummarySchema.nullable().optional(),
  /** Huff-only rerun of the same request (returned for fresh Jev comparisons only). */
  demandSourceCheck: z
    .object({
      primary: z.enum(["jev", "huff"]),
      primaryRanking: z.array(z.string()),
      huffRanking: z.array(z.string()),
      rankingMatches: z.boolean(),
      topMatches: z.boolean(),
    })
    .nullable()
    .optional(),
  assembly: z
    .object({
      findings: z.array(
        z.object({
          code: z.string(),
          message: z.string(),
          siteId: z.string().optional(),
        }),
      ),
      assumptions: z.record(
        z.string(),
        z.object({
          value: z.number().finite(),
          origin: z.enum(["costar", "public", "founder", "default"]),
          evidenceIds: z.array(z.string()),
        }),
      ),
    })
    .optional(),
});
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
export function activeComparisonId(
  href: string,
  saved: SavedComparison | null,
) {
  const ids = new URL(href).searchParams.getAll("comparison");
  return (ids.length === 1 && ids[0]) || saved?.comparisonId;
}
const intakeKey = (projectId: string) => `sitework:intake:v1:${projectId}`;
const fingerprint = (profile: BusinessProfile) => JSON.stringify(profile);

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

function readIntake(projectId: string) {
  try {
    return profileFromIntake(
      JSON.parse(localStorage.getItem(intakeKey(projectId)) ?? "null"),
      projectId,
    );
  } catch {
    return {
      profile: null,
      reason:
        "Saved intake is unavailable. Complete your intake to compare live sites.",
      notes: [],
    };
  }
}

async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  timeout = 15_000,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetcher(path, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Service unavailable");
    return schema.parse(await response.json());
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

export async function requestLiveComparison(
  profile: BusinessProfile,
  candidateIds: string[],
  demandSource: DemandSource,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (
    !candidateIds.length ||
    candidateIds.length > 8 ||
    new Set(candidateIds).size !== candidateIds.length ||
    candidateIds.some((id) => !/^\d+:\d+$/.test(id))
  )
    throw new Error("Choose one to eight distinct candidates");
  const saved = await api(
    "/api/profiles",
    z.object({ profile: BusinessProfileSchema, persisted: z.literal(true) }),
    post({ projectId: profile.projectId, profile }, signal),
    15_000,
    fetcher,
  );
  if (saved.profile.projectId !== profile.projectId)
    throw new Error("Profile identity mismatch");
  const payload = await api(
    "/api/comparisons",
    PayloadSchema,
    post(
      {
        projectId: profile.projectId,
        profileId: saved.profile.id,
        candidateIds,
        demandSource,
      },
      signal,
    ),
    90_000,
    fetcher,
  );
  if (
    payload.result.projectId !== profile.projectId ||
    payload.result.profileId !== saved.profile.id ||
    payload.result.profileVersion !== saved.profile.version ||
    payload.result.sites.some((site) => !candidateIds.includes(site.siteId))
  )
    throw new Error("Comparison identity mismatch");
  return {
    payload,
    saved: {
      projectId: profile.projectId,
      comparisonId: payload.comparisonId,
      profileId: saved.profile.id,
      profileVersion: saved.profile.version,
      intakeFingerprint: fingerprint(profile),
    } satisfies SavedComparison,
  };
}

export function useStoredComparison(
  projectId: string,
  initialComparisonId?: string,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<StoredComparisonState, "retry">>({
    phase: "loading",
    payload: null,
    message: "Loading comparison…",
    failed: false,
  });
  const generation = useRef(0);
  const activeId = useRef<string | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let previous = JSON.stringify(readIntake(projectId).profile);
    const refresh = (event: Event) => {
      if (event.type === INTAKE_UPDATED_EVENT) {
        const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
        if (key !== intakeKey(projectId)) return;
        const next = JSON.stringify(readIntake(projectId).profile);
        if (next === previous) return;
        previous = next;
        setState({
          phase: "loading",
          payload: null,
          message: "Loading comparison…",
          failed: false,
        });
        retry();
        return;
      }
      if (
        !(event instanceof StorageEvent) ||
        !event.key ||
        [intakeKey(projectId), comparisonStorageKey(projectId)].includes(
          event.key,
        )
      )
        retry();
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(INTAKE_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(INTAKE_UPDATED_EVENT, refresh);
    };
  }, [projectId, retry]);
  useEffect(() => {
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    let disposed = false;
    const update = (value: Omit<StoredComparisonState, "retry">) => {
      if (!disposed && generation.current === requestGeneration) {
        activeId.current = value.payload?.comparisonId ?? null;
        setState(value);
      }
    };
    async function load() {
      const intake = readIntake(projectId);
      if (!intake.profile) {
        update({
          phase: "example",
          payload: null,
          message:
            intake.reason ?? "Complete your intake to compare live sites.",
          failed: false,
        });
        return;
      }
      const saved = readSavedComparison(localStorage, projectId);
      const comparisonId = activeComparisonId(window.location.href, saved);
      if (!comparisonId) {
        update({
          phase: "example",
          payload: null,
          message: "Choose sites and run a comparison.",
          failed: false,
        });
        return;
      }
      try {
        const payload = await api(
          `/api/comparisons/${encodeURIComponent(comparisonId)}?projectId=${encodeURIComponent(projectId)}`,
          PayloadSchema,
          { signal: controller.signal },
        );
        if (
          payload.comparisonId !== comparisonId ||
          payload.result.projectId !== projectId
        )
          throw new Error("Comparison identity mismatch");
        const changed =
          saved?.comparisonId === comparisonId &&
          saved.intakeFingerprint !== fingerprint(intake.profile);
        update({
          phase: "ready",
          payload: { ...payload, outdated: payload.outdated || changed },
          message: "",
          failed: false,
        });
      } catch {
        update({
          phase: "example",
          payload: null,
          message:
            "Live comparison unavailable. Showing example data; retry when the service is available.",
          failed: true,
        });
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [projectId, initialComparisonId, attempt]);
  const adopt = useCallback(
    (payload: LiveComparisonPayload, saved: SavedComparison) => {
      generation.current++;
      activeId.current = payload.comparisonId;
      try {
        localStorage.setItem(
          comparisonStorageKey(projectId),
          JSON.stringify(saved),
        );
      } catch {
        /* Explicit replay links still work when storage is unavailable. */
      }
      // Subsequent focus/retry reads the newly adopted comparison, including
      // when this run started from an older comparison permalink.
      const url = new URL(window.location.href);
      url.searchParams.set("comparison", payload.comparisonId);
      window.history.replaceState(window.history.state, "", url);
      const current = readIntake(projectId).profile;
      setState({
        phase: "ready",
        payload: {
          ...payload,
          outdated:
            payload.outdated ||
            !current ||
            fingerprint(current) !== saved.intakeFingerprint,
        },
        message: "",
        failed: false,
      });
    },
    [projectId],
  );
  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "stored",
      phase: state.phase,
      comparisonId: state.payload?.comparisonId,
      synthetic: state.payload?.comparison?.synthetic,
      outdated: state.payload?.outdated,
      siteIds: state.payload?.result.ranking ?? [],
      candidates: [],
    }),
    [state],
  );
  useWorkspaceReport(projectId, context);
  return { ...state, retry, adopt, activeId };
}

export function useLiveComparison(
  projectId: string,
  initialComparisonId?: string,
): LiveComparisonController {
  const [attempt, setAttempt] = useState(0);
  const search = useSiteSearch(projectId, attempt);
  const stored = useStoredComparison(projectId, initialComparisonId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [capability, setCapability] = useState<{
    jev: boolean;
    reason: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState("");
  const [sensitivity, setSensitivity] = useState<
    LiveComparisonController["sensitivity"] & { comparisonId: string | null }
  >({ loading: false, result: null, error: null, comparisonId: null });
  const activeComparison = stored.payload?.comparisonId ?? null;
  const [sensitivityOwner, setSensitivityOwner] = useState(activeComparison);
  // Reset state before rendering another comparison's controls/results.
  if (sensitivityOwner !== activeComparison) {
    setSensitivityOwner(activeComparison);
    setSensitivity({
      loading: false,
      result: null,
      error: null,
      comparisonId: null,
    });
  }
  const operation = useRef<AbortController | null>(null);
  const sensitivityOperation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const previousCandidates = useRef<string | null>(null);
  useEffect(() => {
    sensitivityOperation.current?.abort();
    sensitivityOperation.current = null;
  }, [stored.payload?.comparisonId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      sensitivityOperation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    void api(
      "/api/comparisons/capabilities",
      z.object({ jevConfigured: z.boolean() }),
      { signal: controller.signal },
    )
      .then(({ jevConfigured }) => {
        if (!disposed)
          setCapability({
            jev: jevConfigured,
            reason: jevConfigured
              ? "Jev is configured on the server."
              : "Jev is not configured; using Huff.",
          });
      })
      .catch(() => {
        if (!disposed)
          setCapability({
            jev: false,
            reason: "Jev configuration could not be checked; using Huff.",
          });
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [projectId, attempt]);
  const candidates = useMemo(
    () => (search.state.mode === "live" ? search.state.result.candidates : []),
    [search.state],
  );
  const candidateKey = candidates
    .map(({ candidate }) => candidate.id)
    .join(",");
  useEffect(() => {
    if (
      search.state.mode !== "live" ||
      previousCandidates.current === candidateKey
    )
      return;
    const ids = candidateKey ? candidateKey.split(",") : [];
    const first = previousCandidates.current === null;
    previousCandidates.current = candidateKey;
    setSelectedIds((current) =>
      first ? ids : current.filter((id) => ids.includes(id)),
    );
  }, [candidateKey, search.state.mode]);
  const retry = () => {
    setFailure("");
    setAttempt((n) => n + 1);
    stored.retry();
  };
  const run = async () => {
    if (
      operation.current ||
      search.state.mode !== "live" ||
      !selectedIds.length
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    sensitivityOperation.current?.abort();
    sensitivityOperation.current = null;
    setRunning(true);
    setFailure("");
    setSensitivity({
      loading: false,
      result: null,
      error: null,
      comparisonId: null,
    });
    try {
      const response = await requestLiveComparison(
        search.state.profile,
        selectedIds,
        capability?.jev ? "jev" : "huff",
        controller.signal,
      );
      if (mounted.current && operation.current === controller)
        stored.adopt(response.payload, response.saved);
    } catch {
      if (mounted.current && operation.current === controller)
        setFailure(
          "Live comparison could not be run. Showing example data; retry to try again.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (mounted.current) setRunning(false);
      }
    }
  };
  const runSensitivity = async (assumption: SensitivityAssumption) => {
    const payload = stored.payload;
    if (
      !payload ||
      operation.current ||
      (sensitivity.loading && sensitivity.comparisonId === payload.comparisonId)
    )
      return;
    const controller = new AbortController();
    sensitivityOperation.current?.abort();
    sensitivityOperation.current = controller;
    setSensitivity({
      loading: true,
      result: null,
      error: null,
      comparisonId: payload.comparisonId,
    });
    try {
      const response = await api(
        `/api/comparisons/${encodeURIComponent(payload.comparisonId)}/sensitivity`,
        z.object({
          comparisonId: z.string(),
          sensitivity: SensitivityResultSchema,
        }),
        post({ projectId, assumption }, controller.signal),
        90_000,
      );
      if (response.comparisonId !== payload.comparisonId)
        throw new Error("Sensitivity identity mismatch");
      if (
        mounted.current &&
        sensitivityOperation.current === controller &&
        stored.activeId.current === payload.comparisonId
      )
        setSensitivity({
          loading: false,
          result: response.sensitivity,
          error: null,
          comparisonId: payload.comparisonId,
        });
    } catch {
      if (
        mounted.current &&
        sensitivityOperation.current === controller &&
        stored.activeId.current === payload.comparisonId
      )
        setSensitivity({
          loading: false,
          result: null,
          error:
            "Sensitivity unavailable. Your comparison is unchanged; try again.",
          comparisonId: payload.comparisonId,
        });
    }
  };
  const phase = running
    ? "running"
    : failure || search.state.mode === "example" || stored.failed
      ? "example"
      : search.state.mode === "loading" ||
          stored.phase === "loading" ||
          capability === null
        ? "loading"
        : "ready";
  const context = useMemo<WorkspaceObservation>(
    () => ({
      kind: "comparison",
      phase,
      comparisonId: stored.payload?.comparisonId,
      synthetic: stored.payload?.comparison?.synthetic,
      outdated: stored.payload?.outdated,
      siteIds: stored.payload?.result.ranking ?? [],
      candidates: candidates.map((entry) => entry.candidate),
    }),
    [phase, stored.payload, candidates],
  );
  useWorkspaceReport(projectId, context);
  return {
    phase,
    candidates,
    search: search.readiness,
    selectedIds,
    setSelectedIds,
    payload: stored.payload,
    message:
      failure ||
      (search.state.mode === "example"
        ? search.state.message
        : search.state.mode === "live" && !candidates.length
          ? (search.state.result.emptyReason ??
            "No candidate sites match this intake.")
          : stored.message),
    notes: search.state.mode === "live" ? search.state.notes : [],
    demandSource: capability?.jev ? "jev" : "huff",
    demandSourceReason: capability?.reason ?? "Checking demand configuration…",
    retry,
    run,
    sensitivity:
      sensitivity.comparisonId === stored.payload?.comparisonId
        ? sensitivity
        : { loading: false, result: null, error: null },
    runSensitivity,
  };
}
