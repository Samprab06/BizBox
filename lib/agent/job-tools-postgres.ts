import "server-only";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { investigations } from "@/lib/db/schema";
import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { createInvestigationService } from "./jobs";
import { createPostgresInvestigationRepository } from "./jobs-postgres";
import {
  createJobsPort,
  type InvestigationCounts,
  type JobsPort,
} from "./job-tools";

/** HAC-151: the caps' counts, read from the durable `investigations` table. */
export function createPostgresInvestigationCounts(
  database: typeof getDb = getDb,
): InvestigationCounts {
  return {
    async activeFor(projectId) {
      const [row] = await database()
        .select({ id: investigations.id })
        .from(investigations)
        .where(
          and(
            eq(investigations.projectId, projectId),
            inArray(investigations.status, ["queued", "running"]),
          ),
        )
        .orderBy(desc(investigations.createdAt))
        .limit(1);
      return row?.id ?? null;
    },
    async startsSince(projectId, since) {
      const [row] = await database()
        .select({ total: count() })
        .from(investigations)
        .where(
          and(
            eq(investigations.projectId, projectId),
            gte(investigations.createdAt, since),
          ),
        );
      return Number(row?.total ?? 0);
    },
  };
}

/** Builds lazily, so no database connection opens until the agent starts a job. */
export function createPostgresJobsPort(): JobsPort {
  let port: JobsPort | undefined;
  const get = () =>
    (port ??= createJobsPort({
      profiles: createPostgresProfileStore(),
      create: (input) =>
        createInvestigationService(
          createPostgresInvestigationRepository(),
        ).create(input),
      counts: createPostgresInvestigationCounts(),
    }));
  return {
    saveProfile: (projectId, profile) => get().saveProfile(projectId, profile),
    startInvestigation: (input) => get().startInvestigation(input),
  };
}
