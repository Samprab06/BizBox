import "server-only";
import { and, eq, max } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { comparisons, profiles, siteRuns } from "@/lib/db/schema";
import type { ComparisonStore, StoredComparison } from "./store";

/** Comparisons in Postgres: canonical SiteComparison in `data`, full evaluation in `evaluation`. */
export function createPostgresComparisonStore(): ComparisonStore {
  return {
    async save(record) {
      const { request } = record.evaluation;
      await getDb().transaction(async (tx) => {
        await tx.insert(comparisons).values({
          id: record.id,
          projectId: request.projectId,
          profileId: request.profileId,
          data: record.comparison,
          evaluation: record.evaluation,
        });
        if (record.runs.length) {
          await tx.insert(siteRuns).values(
            record.runs.map(({ events, ...data }) => ({
              id: data.id,
              projectId: data.projectId,
              profileId: data.profileId,
              comparisonId: record.id,
              siteId: data.siteId,
              seed: data.seed,
              modelVersion: data.modelVersion,
              data,
              events,
            })),
          );
        }
      });
    },

    async load(projectId, comparisonId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(comparisons)
        .where(and(eq(comparisons.projectId, projectId), eq(comparisons.id, comparisonId)))
        .limit(1);
      if (!row?.evaluation) return null;
      const runs = await db
        .select()
        .from(siteRuns)
        .where(and(eq(siteRuns.projectId, projectId), eq(siteRuns.comparisonId, comparisonId)));
      return {
        id: row.id,
        evaluation: row.evaluation,
        comparison: row.data,
        runs: runs.map((r) => ({ ...r.data, events: r.events })),
      } satisfies StoredComparison;
    },

    async currentProfileVersion(projectId) {
      const [row] = await getDb()
        .select({ version: max(profiles.version) })
        .from(profiles)
        .where(eq(profiles.projectId, projectId));
      return row?.version ?? null;
    },

    async saveSensitivity(projectId, comparisonId, record) {
      await getDb()
        .update(comparisons)
        .set({ data: record.comparison, evaluation: record.evaluation })
        .where(and(eq(comparisons.projectId, projectId), eq(comparisons.id, comparisonId)));
    },
  };
}
