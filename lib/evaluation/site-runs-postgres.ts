import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

type Executor = { execute(query: SQL): PromiseLike<unknown> };

/** Selects only canonical replay data/events; the handler validates SiteRunSchema. */
export function createPostgresSiteRunLoader(database: () => Executor = getDb) {
  return async (projectId: string, runId: string): Promise<unknown | null> => {
    const rows = await database().execute(sql`SELECT data,events FROM site_runs
      WHERE project_id=${projectId} AND id=${runId} LIMIT 1`);
    if (!Array.isArray(rows)) throw new Error("Invalid database response");
    if (!rows[0]) return null;
    const { data, events } = rows[0];
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid stored site run");
    return { ...data, events };
  };
}
