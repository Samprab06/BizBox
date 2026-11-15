import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import { AgentViewCandidateSchema } from "@/lib/contracts/agent";
import { getDb } from "@/lib/db/client";
import { investigations, profiles } from "@/lib/db/schema";
import { loadSiteInventory } from "@/app/api/sites/inventory";
import { searchSites } from "@/lib/data/sites";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import type { ViewContextLookups } from "./view-context";

/** Read-only, lazy composition. Global listing existence never establishes project scope. */
export function createPostgresViewContextLookups(): ViewContextLookups {
  const comparisons = createPostgresComparisonStore();
  const scenarios = createPostgresScenarioRepository();
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
    scenario: (projectId, id) => scenarios.get(projectId, id),
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
      const result = await search(projectId, currentProfile);
      return result
        ? result.candidates.map((entry) => entry.candidate.id)
        : null;
    },
    async candidateFacts(projectId, currentProfile) {
      const result = await search(projectId, currentProfile);
      if (!result) return null;
      return result.candidates.flatMap(({ candidate, score }) => {
        const rentCents = candidate.monthlyRentCents.value;
        const sqft = candidate.floorAreaSqFt.value;
        const fact = AgentViewCandidateSchema.safeParse({
          id: candidate.id,
          address: candidate.address.slice(0, 300),
          ...(rentCents !== null && rentCents >= 0
            ? { monthlyRentUsd: rentCents / 100 }
            : {}),
          ...(sqft !== null && sqft > 0 ? { sqft } : {}),
          ...(Number.isFinite(score) ? { score } : {}),
        });
        return fact.success ? [fact.data] : [];
      });
    },
  };
}

/** The server shortlist for the canonical current or latest saved profile; null without one. */
async function search(
  projectId: string,
  currentProfile?: BusinessProfile | null,
) {
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
  return searchSites({ profile, limit: 8 }, await loadSiteInventory());
}
