import "server-only";
import { and, eq } from "drizzle-orm";
import { createNessieConsultantReader } from "@/lib/nessie/consultant";
import { loadSiteInventory } from "@/app/api/sites/inventory";
import { getDb } from "@/lib/db/client";
import { comparisons, siteRuns } from "@/lib/db/schema";
import { searchSites } from "@/lib/data/sites";
import { getCatchment } from "@/lib/data/catchment-repository";
import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { withSensitivity } from "@/lib/evaluation/store";
import { assembleEvaluation } from "@/lib/evaluation/assemble";
import { createPostgresAssemblyDependencies } from "@/lib/evaluation/assemble-db";
import {
  createJevClientFromEnv,
  JEV_MODEL_VERSION,
  type JevClient,
} from "@/lib/panel/jev-client";
import {
  createInvestigationTools,
  toolArtifactId,
  type InvestigationToolDependencies,
} from "./tools";

/** Transport cancellation reaches the provider request itself, not just a job's Promise.race. */
export function createAbortablePanelClient(
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetcher = globalThis.fetch,
): JevClient {
  return createJevClientFromEnv(env, {
    fetch: async (input, init) => {
      signal.throwIfAborted();
      const signals = init?.signal ? [signal, init.signal] : [signal];
      return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
    },
    sleep: (ms) =>
      new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Investigation aborted"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
      }),
  });
}

export function createPostgresInvestigationToolDependencies(): InvestigationToolDependencies {
  const profileStore = createPostgresProfileStore();
  const store = createPostgresComparisonStore();
  return {
    jevConfigured: Boolean(process.env.JEV_API_KEY?.trim()),
    readNessieCashBuffer: createNessieConsultantReader(),
    loadProfile: (projectId, profileId) =>
      profileStore.load(projectId, profileId),
    async saveProfile(projectId, profile, key, signal) {
      const id = toolArtifactId("profile", key);
      const existing = await profileStore.load(projectId, id);
      if (existing) return existing;
      signal.throwIfAborted();
      try {
        return await createPostgresProfileStore(getDb, () => id).saveSnapshot(
          projectId,
          profile,
        );
      } catch (error) {
        const saved = await profileStore.load(projectId, id);
        if (!saved) throw error;
        return saved;
      }
    },
    async search(profile, filters, signal) {
      signal.throwIfAborted();
      const inventory = await loadSiteInventory();
      signal.throwIfAborted();
      return searchSites({ profile, ...filters }, inventory);
    },
    async catchment(profile, siteId, signal) {
      if (profile.category === "unsupported")
        throw new Error("Unsupported category");
      signal.throwIfAborted();
      const response = await getCatchment(
        siteId,
        {
          projectId: profile.projectId,
          category: profile.category,
          radiusMeters: 1000,
        },
        "default",
      );
      signal.throwIfAborted();
      return response;
    },
    async assemble(profile, ids, options, signal, deadline) {
      signal.throwIfAborted();
      const inputProfile = structuredClone(profile);
      if (options.price !== undefined)
        inputProfile.economics.averageTicketCents = {
          value: Math.round(options.price * 100),
          origin: "default",
          unit: "USD cents/customer",
          evidenceIds: ["orchestrator-price-scenario"],
        };
      const modelVersion = process.env.JEV_MODEL?.trim() || JEV_MODEL_VERSION;
      const client: JevClient | undefined =
        options.mode === "paid" && process.env.JEV_API_KEY?.trim()
          ? createAbortablePanelClient(signal)
          : options.mode === "cache-only"
            ? {
                modelVersion,
                ask: async () => {
                  throw new Error(
                    "No cached panel response; paid calls are forbidden during evaluation",
                  );
                },
              }
            : undefined;
      const deps = createPostgresAssemblyDependencies(
        getDb(),
        profile.projectId,
        client,
      );
      const get = deps.getCatchment;
      deps.getCatchment = async (...args) => {
        signal.throwIfAborted();
        const result = await get(...args);
        if (options.competitor_ids !== undefined)
          result.response.competitors = result.response.competitors.filter(
            (c) => options.competitor_ids!.includes(c.id),
          );
        signal.throwIfAborted();
        return result;
      };
      const assembled = await assembleEvaluation(
        {
          projectId: profile.projectId,
          profileId: profile.id,
          profileVersion: profile.version,
          profile: inputProfile,
          candidateIds: ids,
          demandSource: options.mode === "huff" ? "huff" : "jev",
        },
        deps,
        deadline,
      );
      signal.throwIfAborted();
      return assembled;
    },
    comparisons: store,
    async saveSensitivity(projectId, comparisonId, record, signal) {
      const sensitivity = record.evaluation.sensitivity.at(-1);
      if (!sensitivity) return;
      await getDb().transaction(async (tx) => {
        const [latest] = await tx
          .select()
          .from(comparisons)
          .where(
            and(
              eq(comparisons.projectId, projectId),
              eq(comparisons.id, comparisonId),
            ),
          )
          .for("update");
        if (!latest?.evaluation) throw new Error("Comparison unavailable");
        signal.throwIfAborted();
        const merged = withSensitivity(
          {
            id: latest.id,
            evaluation: latest.evaluation,
            comparison: latest.data,
            runs: record.runs,
          },
          sensitivity,
        );
        await tx
          .update(comparisons)
          .set({ data: merged.comparison, evaluation: merged.evaluation })
          .where(
            and(
              eq(comparisons.projectId, projectId),
              eq(comparisons.id, comparisonId),
            ),
          );
      });
    },
    async comparisonForRun(projectId, runId) {
      const [row] = await getDb()
        .select({ comparisonId: siteRuns.comparisonId })
        .from(siteRuns)
        .where(and(eq(siteRuns.projectId, projectId), eq(siteRuns.id, runId)))
        .limit(1);
      return row?.comparisonId ? store.load(projectId, row.comparisonId) : null;
    },
  };
}

export function createPostgresInvestigationTools() {
  return createInvestigationTools(
    createPostgresInvestigationToolDependencies(),
  );
}
