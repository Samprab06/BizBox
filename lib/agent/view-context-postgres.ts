import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { BusinessProfileSchema } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { investigations, profiles } from "@/lib/db/schema";
import { loadSiteInventory } from "@/app/api/sites/inventory";
import { searchSites } from "@/lib/data/sites";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import type { ViewContextLookups } from "./view-context";

/** Read-only, lazy composition. Global listing existence never establishes project scope. */
export function createPostgresViewContextLookups(): ViewContextLookups {
  const comparisons = createPostgresComparisonStore();
  return {
    async comparison(projectId, id) {
      const record = await comparisons.load(projectId, id);
      if (
        !record ||
        record.id !== id ||
        record.comparison.projectId !== projectId ||
        record.evaluation.request.projectId !== projectId ||
        record.evaluation.result.projectId !== projectId
      )
        return null;
      return {
        id: record.id,
        projectId: record.comparison.projectId,
        siteIds: record.evaluation.request.sites.map((site) => site.siteId),
      };
    },
    // Scene 1 removed the Copilot, the only client that sent a scenarioId. The view no
    // longer resolves scenarios, so any scenarioId fails closed as an invalid reference.
    scenario: async () => null,
    async investigation(projectId, id) {
      const [record] = await getDb()
        .select({ id: investigations.id, projectId: investigations.projectId })
        .from(investigations)
        .where(
          and(
            eq(investigations.projectId, projectId),
            eq(investigations.id, id),
          ),
        )
        .limit(1);
      return record ?? null;
    },
    async candidates(projectId, currentProfile) {
      let profile = currentProfile;
      if (!profile) {
        const [record] = await getDb()
          .select({
            id: profiles.id,
            projectId: profiles.projectId,
            version: profiles.version,
            snapshot: profiles.snapshot,
          })
          .from(profiles)
          .where(eq(profiles.projectId, projectId))
          .orderBy(desc(profiles.version))
          .limit(1);
        if (!record) return null;
        profile = BusinessProfileSchema.parse(record.snapshot);
        if (profile.id !== record.id || profile.version !== record.version)
          throw new Error("Profile scope mismatch");
      }
      if (profile.projectId !== projectId)
        throw new Error("Profile scope mismatch");
      const result = searchSites(
        { profile, limit: 8 },
        await loadSiteInventory(),
      );
      return result.candidates.map((entry) => entry.candidate.id);
    },
  };
}
