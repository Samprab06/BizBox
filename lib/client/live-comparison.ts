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
import {
  useSiteSearch,
  type NeedsBrief,
  type SiteSearchReadiness,
} from "./use-site-search";
import { INTAKE_UPDATED_EVENT } from "./intake-events";
import {
  activeComparisonId,
  comparisonStorageKey,
  pickSiteTweaks,
  readSavedComparison,
  readShortlist,
  restoreShortlist,
  siteTweaksKey,
  writeSavedComparison,
  writeShortlist,
  type SavedComparison,
} from "./project-store";
import { readFlowState, useFlowProgress } from "./flow-progress";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import {
  MAX_COMPARE_UNITS,
  type DemandSource,
  type EvaluationResult,
  type SensitivityAssumption,
  type SensitivityResult,
  type SiteTweakMap,
} from "@/lib/contracts/evaluation";
import type { FlowEvent } from "@/lib/contracts/agent";
import type { ContextListing } from "./workspace-context";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";
import {
  createPanelResendBackoff,
  PanelInProgressBodySchema,
  panelProgressMessage,
  type PanelProgressCount,
} from "@/lib/panel/progress";

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
  /**
   * Scene 1: the tweaks this run used (`siteTweaksKey`), known from the saved comparison;
   * "" or absent means none.
   */
  tweaksKey?: string;
};

/** Scene 1: what the running comparison is doing, for the progress panel. */
export type ComparisonRun = {
  siteIds: string[];
  demandSource: DemandSource;
  /** `Date.now()` when the run began. */
  startedAt: number;
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
  /** HAC-155: a deadline-limited Jev panel still being resumed; never a finished result. */
  panelProgress: PanelProgressCount | null;
  /** Scene 1: the run in progress, or null. */
  activeRun?: ComparisonRun | null;
  /** Scene 1: `siteTweaksKey` of the current selection; compare with `payload.tweaksKey`. */
  tweaksKey?: string;
  /** Scene 1: why the last run failed (the selection is kept), or "". */
  runError?: string;
  notes: string[];
  demandSource: DemandSource;
  demandSourceReason: string;
  retry: () => void;
  /** Runs the selection, or `ids` (which then become the selection). */
  run: (ids?: string[]) => Promise<void>;
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
  readiness?: NeedsBrief;
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
export {
  activeComparisonId,
  comparisonStorageKey,
  readSavedComparison,
  type SavedComparison,
} from "./project-store";
const intakeKey = (projectId: string) => `sitework:intake:v1:${projectId}`;
const fingerprint = (profile: BusinessProfile) => JSON.stringify(profile);

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
  const { ok, body } = await send(path, init, timeout, fetcher);
  if (!ok) throw new Error("Service unavailable");
  return schema.parse(body);
}

async function send(
  path: string,
  init: RequestInit,
  timeout: number,
  fetcher: typeof fetch,
): Promise<{ ok: boolean; status: number; body: unknown }> {
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
    if (!response.ok) return { ok: false, status: response.status, body: null };
    return {
      ok: true,
      status: response.status,
      body: await response.json(),
    };
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

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * POST /api/comparisons until it returns the comparison. A 202 `in_progress` (HAC-155) means the
 * Jev panel hit the function deadline with its answers cached: it is reported through
 * `onProgress` and the same body is resent with `createPanelResendBackoff`. Never an error and
 * never a result by itself.
 */
async function postComparison(
  body: unknown,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
  onProgress?: (progress: PanelProgressCount) => void,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = wait,
) {
  const backoff = createPanelResendBackoff();
  for (;;) {
    const response = await send(
      "/api/comparisons",
      post(body, signal),
      90_000,
      fetcher,
    );
    if (!response.ok) throw new Error("Service unavailable");
    if (response.status !== 202) return PayloadSchema.parse(response.body);
    const progress = PanelInProgressBodySchema.parse(response.body);
    onProgress?.({
      completedPersonas: progress.completedPersonas,
      totalPersonas: progress.totalPersonas,
    });
    const delay = backoff.next(progress);
    if (delay === null) throw new Error("Jev panel is not making progress");
    await sleep(delay, signal);
  }
}

export async function requestLiveComparison(
  profile: BusinessProfile,
  candidateIds: string[],
  demandSource: DemandSource,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  options: {
    onProgress?: (progress: PanelProgressCount) => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Scene 1: per-site tweaks (filtered to `candidateIds`; sent only when non-empty). */
    siteTweaks?: SiteTweakMap;
  } = {},
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
  const siteTweaks = pickSiteTweaks(candidateIds, options.siteTweaks ?? {});
  const tweaksKey = siteTweaksKey(candidateIds, siteTweaks);
  const payload = await postComparison(
    {
      projectId: profile.projectId,
      profileId: saved.profile.id,
      candidateIds,
      demandSource,
      ...(tweaksKey ? { siteTweaks } : {}),
    },
    signal,
    fetcher,
    options.onProgress,
    options.sleep,
  );
  if (
    payload.result.projectId !== profile.projectId ||
    payload.result.profileId !== saved.profile.id ||
    payload.result.profileVersion !== saved.profile.version ||
    payload.result.sites.some((site) => !candidateIds.includes(site.siteId))
  )
    throw new Error("Comparison identity mismatch");
  return {
    payload: { ...payload, tweaksKey } as LiveComparisonPayload,
    saved: {
      projectId: profile.projectId,
      comparisonId: payload.comparisonId,
      profileId: saved.profile.id,
      profileVersion: saved.profile.version,
      intakeFingerprint: fingerprint(profile),
      tweaksKey,
    } satisfies SavedComparison,
  };
}

/** Scene 1: which quarter of the Jev panel has answered (0-4); 4 is every persona. */
export function progressBand({
  completedPersonas,
  totalPersonas,
}: PanelProgressCount): number {
  if (totalPersonas <= 0) return 0;
  const share = Math.min(1, Math.max(0, completedPersonas / totalPersonas));
  return Math.floor(share * 4);
}

/**
 * Scene 1: the `comparison_progress` event to post for this poll, or null. The consultant
 * hears about a run at most once per 25% band (25, 50, 75, 100%), never on every poll.
 */
export function progressReport(
  lastBand: number,
  progress: PanelProgressCount,
): { band: number; event: FlowEvent | null } {
  const band = progressBand(progress);
  if (band <= lastBand || progress.totalPersonas <= 0)
    return { band: Math.max(band, lastBand), event: null };
  return {
    band,
    event: {
      kind: "comparison_progress",
      completed: Math.min(progress.completedPersonas, progress.totalPersonas),
      total: progress.totalPersonas,
    },
  };
}

/** Scene 1: the listing facts the consultant may cite, for the workspace report. */
export function contextListing(
  entry: SiteSearchResult["candidates"][number],
): ContextListing {
  const { candidate } = entry;
  const rent =
    entry.baseRentCents.value !== null &&
    entry.baseRentCents.unit === "USD cents/month"
      ? entry.baseRentCents.value / 100
      : undefined;
  const sqft = candidate.floorAreaSqFt.value ?? undefined;
  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address,
    synthetic: candidate.synthetic,
    ...(rent !== undefined && rent >= 0 ? { monthlyRentUsd: rent } : {}),
    ...(sqft !== undefined && sqft > 0 ? { sqft } : {}),
    score: entry.score,
  };
}

/**
 * HAC-151: runs a comparison the consultant asked for, outside any React state: the saved intake
 * becomes the profile, then the same profile -> comparison path as the Run button. Saves the
 * shortlist and the comparison so the comparison screen opens the result.
 */
export async function runAgentComparison(
  projectId: string,
  siteIds: string[],
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    storage?: Pick<Storage, "getItem">;
    onProgress?: (progress: PanelProgressCount) => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    siteTweaks?: SiteTweakMap;
  } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let raw: unknown = null;
  try {
    raw = JSON.parse(
      (options.storage ?? localStorage).getItem(
        `sitework:intake:v1:${projectId}`,
      ) ?? "null",
    );
  } catch {
    /* An unreadable intake is reported below as an incomplete one. */
  }
  const { profile, reason } = profileFromIntake(raw, projectId);
  if (!profile) throw new Error(reason ?? "Complete the intake first");
  const capability = await api(
    "/api/comparisons/capabilities",
    z.object({ jevConfigured: z.boolean() }),
    { signal: options.signal },
    15_000,
    fetcher,
  ).catch(() => null);
  const response = await requestLiveComparison(
    profile,
    siteIds,
    capability?.jevConfigured ? "jev" : "huff",
    options.signal,
    fetcher,
    {
      onProgress: options.onProgress,
      sleep: options.sleep,
      siteTweaks: options.siteTweaks,
    },
  );
  writeShortlist(projectId, siteIds);
  writeSavedComparison(response.saved);
  return response;
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
        const message =
          intake.reason ?? "Complete your intake to compare live sites.";
        update({
          phase: "example",
          payload: null,
          message,
          failed: false,
          readiness: { status: "needs_brief", message },
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
          payload: {
            ...payload,
            outdated: payload.outdated || changed,
            tweaksKey:
              saved?.comparisonId === comparisonId
                ? (saved.tweaksKey ?? "")
                : "",
          },
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
      writeSavedComparison(saved);
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
          tweaksKey: saved.tweaksKey ?? "",
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
      needsBrief: state.readiness?.status === "needs_brief",
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
  options: {
    manualSelection?: boolean;
    /**
     * Scene 1: told when a run starts, makes panel progress (at most once per 25% band),
     * finishes or fails. Called synchronously; must not throw or block the run.
     */
    onFlowEvent?: (event: FlowEvent) => void;
  } = {},
): LiveComparisonController {
  const [attempt, setAttempt] = useState(0);
  const search = useSiteSearch(projectId, attempt);
  const stored = useStoredComparison(projectId, initialComparisonId);
  const [selectedIds, setSelectedIdsState] = useState<string[]>([]);
  const selectedRef = useRef(selectedIds);
  // HAC-135: the shortlist is saved per project, so it survives navigation.
  const setSelectedIds = useCallback(
    (ids: string[]) => {
      const current = selectedRef.current;
      // A failed run's message belongs to the units it ran; another choice clears it.
      if (
        ids.length !== current.length ||
        ids.some((id) => !current.includes(id))
      )
        setFailure("");
      selectedRef.current = ids;
      setSelectedIdsState(ids);
      writeShortlist(projectId, ids);
    },
    [projectId],
  );
  useEffect(() => {
    selectedRef.current = selectedIds;
  }, [selectedIds]);
  const flowEventRef = useRef(options.onFlowEvent);
  useEffect(() => {
    flowEventRef.current = options.onFlowEvent;
  }, [options.onFlowEvent]);
  const emit = (event: FlowEvent) => {
    try {
      flowEventRef.current?.(event);
    } catch {
      /* The consultant hearing about the run never affects the run. */
    }
  };
  // Scene 1: per-site tweaks from the guided flow apply to the next run.
  const { siteTweaks } = useFlowProgress(projectId).state;
  const [activeRun, setActiveRun] = useState<ComparisonRun | null>(null);
  const [capability, setCapability] = useState<{
    jev: boolean;
    reason: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [panelProgress, setPanelProgress] = useState<PanelProgressCount | null>(
    null,
  );
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
    setSelectedIdsState((current) => {
      if (!first) return current.filter((id) => ids.includes(id));
      const saved = readShortlist(localStorage, projectId);
      const restored = restoreShortlist(saved, ids);
      // HAC-162: the client workspace starts with nothing chosen and compares at most
      // MAX_COMPARE_UNITS units, so it restores only a saved shortlist that fits that limit.
      const next = options.manualSelection
        ? saved && restored.length <= MAX_COMPARE_UNITS
          ? restored
          : []
        : restored;
      selectedRef.current = next;
      return next;
    });
  }, [candidateKey, search.state.mode, projectId, options.manualSelection]);
  const retry = () => {
    setFailure("");
    setAttempt((n) => n + 1);
    stored.retry();
  };
  const run = async (override?: string[]) => {
    if (operation.current || search.state.mode !== "live") return;
    const live = candidates.map(({ candidate }) => candidate.id);
    const ids = override
      ? [...new Set(override)].filter((id) => live.includes(id))
      : selectedRef.current;
    if (!ids.length) return;
    if (override) setSelectedIds(ids);
    const demandSource: DemandSource = capability?.jev ? "jev" : "huff";
    const controller = new AbortController();
    operation.current = controller;
    sensitivityOperation.current?.abort();
    sensitivityOperation.current = null;
    setRunning(true);
    setActiveRun({ siteIds: ids, demandSource, startedAt: Date.now() });
    setPanelProgress(null);
    setFailure("");
    setSensitivity({
      loading: false,
      result: null,
      error: null,
      comparisonId: null,
    });
    if (ids.length <= MAX_COMPARE_UNITS)
      emit({ kind: "comparison_started", siteIds: ids, demandSource });
    let band = 0;
    try {
      const response = await requestLiveComparison(
        search.state.profile,
        ids,
        demandSource,
        controller.signal,
        fetch,
        {
          onProgress: (progress) => {
            if (!mounted.current || operation.current !== controller) return;
            setPanelProgress(progress);
            const report = progressReport(band, progress);
            band = report.band;
            if (report.event) emit(report.event);
          },
          // Read at run time: an agent's tweak may land in the same reply as the run.
          siteTweaks: readFlowState(projectId).siteTweaks,
        },
      );
      if (mounted.current && operation.current === controller) {
        writeShortlist(projectId, ids);
        stored.adopt(response.payload, response.saved);
        emit({
          kind: "comparison_finished",
          comparisonId: response.payload.comparisonId,
        });
      }
    } catch {
      if (mounted.current && operation.current === controller) {
        setFailure(
          options.manualSelection
            ? "Comparison unavailable. Your selected units are unchanged."
            : "Live comparison could not be run. Showing example data; retry to try again.",
        );
        emit({ kind: "comparison_failed", reason: "Comparison unavailable" });
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (mounted.current) {
          setRunning(false);
          setActiveRun(null);
          setPanelProgress(null);
        }
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
      needsBrief: search.readiness.status === "needs_brief",
      comparisonId: stored.payload?.comparisonId,
      synthetic: stored.payload?.comparison?.synthetic,
      outdated: stored.payload?.outdated,
      siteIds: stored.payload?.result.ranking ?? [],
      candidates: candidates.map(contextListing),
      ...(options.manualSelection
        ? { shortlistIds: selectedIds.slice(0, MAX_COMPARE_UNITS) }
        : {}),
    }),
    [
      phase,
      search.readiness.status,
      stored.payload,
      candidates,
      selectedIds,
      options.manualSelection,
    ],
  );
  useWorkspaceReport(projectId, context);
  return {
    phase,
    candidates,
    search: search.readiness,
    selectedIds,
    setSelectedIds,
    payload: stored.payload,
    panelProgress: running ? panelProgress : null,
    activeRun: running ? activeRun : null,
    tweaksKey: siteTweaksKey(selectedIds, siteTweaks),
    runError: failure,
    message:
      failure ||
      (running && panelProgress ? panelProgressMessage(panelProgress) : "") ||
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
