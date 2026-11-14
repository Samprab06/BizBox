import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { costarProperties, costarSpaces } from "@/lib/db/costar-schema";
import { comparisons, investigations } from "@/lib/db/schema";
import type { IntakeUiLookups } from "@/lib/agent/ui-tools";

/**
 * HAC-144: the UI tools' trusted ID checks. Read-only, ID columns only. A site is a
 * marketed suite (`listingId:spaceId`, the search candidate ID) or a CoStar property ID.
 */
export function createPostgresIntakeUiLookups(
  database: typeof getDb = getDb,
): IntakeUiLookups {
  return {
    async site(siteId) {
      const db = database();
      if (siteId.includes(":")) {
        const [row] = await db
          .select({ city: costarProperties.city })
          .from(costarSpaces)
          .leftJoin(
            costarProperties,
            eq(costarProperties.id, costarSpaces.propertyId),
          )
          .where(eq(costarSpaces.id, siteId))
          .limit(1);
        return row ? { city: row.city ?? null } : null;
      }
      const [row] = await db
        .select({ city: costarProperties.city })
        .from(costarProperties)
        .where(eq(costarProperties.id, siteId))
        .limit(1);
      return row ? { city: row.city ?? null } : null;
    },
    async comparisonExists(projectId, comparisonId) {
      const rows = await database()
        .select({ id: comparisons.id })
        .from(comparisons)
        .where(
          and(
            eq(comparisons.projectId, projectId),
            eq(comparisons.id, comparisonId),
          ),
        )
        .limit(1);
      return rows.length === 1;
    },
    async investigationExists(projectId, investigationId) {
      const rows = await database()
        .select({ id: investigations.id })
        .from(investigations)
        .where(
          and(
            eq(investigations.projectId, projectId),
            eq(investigations.id, investigationId),
          ),
        )
        .limit(1);
      return rows.length === 1;
    },
  };
}
