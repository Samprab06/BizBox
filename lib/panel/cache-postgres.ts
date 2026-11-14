import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CatchmentExecutor } from "@/lib/data/catchment-repository";
import type { JevCache } from "./cache";
import type { JevAskResult } from "./jev-client";

const CachedResult = z.object({
  modelVersion: z.string().min(1),
  answers: z.record(
    z.string(),
    z.object({
      probabilities: z.record(z.string(), z.number().finite().min(0).max(1)),
      confidence: z.number().finite().min(0).max(1),
    }),
  ),
});

/**
 * Project-scoped immutable-request cache. modelVersion is the requested alias
 * (also part of the request hash); response.modelVersion retains the API's
 * resolved version, which is legitimately different for aliases such as jev-latest.
 * No requests, keys or API credentials are logged.
 */
export function createPostgresJevCache(
  db: CatchmentExecutor,
  projectId: string,
  modelVersion: string,
): JevCache {
  return {
    async get(key) {
      const rows = await db.execute(sql`SELECT response FROM jev_cache
        WHERE project_id=${projectId} AND cache_key=${key} AND model_version=${modelVersion}
        AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`);
      if (!Array.isArray(rows) || !rows[0]) return undefined;
      const parsed = CachedResult.safeParse(rows[0].response);
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, value: JevAskResult) {
      const parsed = CachedResult.parse(value);
      const id = `jev:${createHash("sha256").update(`${projectId}\n${key}`).digest("hex")}`;
      await db.execute(sql`INSERT INTO jev_cache(id,project_id,cache_key,model_version,response)
        VALUES(${id},${projectId},${key},${modelVersion},${JSON.stringify(parsed)}::jsonb)
        ON CONFLICT(project_id,cache_key) DO UPDATE SET
          model_version=excluded.model_version,response=excluded.response,expires_at=NULL`);
    },
  };
}
