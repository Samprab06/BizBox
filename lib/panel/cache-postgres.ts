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
const READ_CHUNK = 2000;
const WRITE_CHUNK = 200;

export function createPostgresJevCache(
  db: CatchmentExecutor,
  projectId: string,
  modelVersion: string,
): JevCache {
  const rowId = (key: string) => `jev:${createHash("sha256").update(`${projectId}\n${key}`).digest("hex")}`;
  return {
    /** One `SELECT ... WHERE cache_key IN (...)` per chunk of keys (one for any real run). */
    async getMany(keys) {
      const out = new Map<string, JevAskResult>();
      const unique = [...new Set(keys)];
      for (let i = 0; i < unique.length; i += READ_CHUNK) {
        const chunk = unique.slice(i, i + READ_CHUNK);
        const rows = await db.execute(sql`SELECT cache_key,response FROM jev_cache
        WHERE project_id=${projectId} AND model_version=${modelVersion}
        AND cache_key IN (${sql.join(
          chunk.map((k) => sql`${k}`),
          sql`, `,
        )})
        AND (expires_at IS NULL OR expires_at>now())`);
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const parsed = CachedResult.safeParse(row.response);
          if (parsed.success && typeof row.cache_key === "string") out.set(row.cache_key, parsed.data);
        }
      }
      return out;
    },
    /** One multi-row upsert per chunk of answers. Later entries win for a repeated key. */
    async setMany(entries) {
      const byKey = new Map<string, JevAskResult>();
      for (const e of entries) byKey.set(e.key, CachedResult.parse(e.value));
      const all = [...byKey];
      for (let i = 0; i < all.length; i += WRITE_CHUNK) {
        const tuples = all
          .slice(i, i + WRITE_CHUNK)
          .map(
            ([key, value]) =>
              sql`(${rowId(key)},${projectId},${key},${modelVersion},${JSON.stringify(value)}::jsonb)`,
          );
        await db.execute(sql`INSERT INTO jev_cache(id,project_id,cache_key,model_version,response)
        VALUES ${sql.join(tuples, sql`, `)}
        ON CONFLICT(project_id,cache_key) DO UPDATE SET
          model_version=excluded.model_version,response=excluded.response,expires_at=NULL`);
      }
    },
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
      const id = rowId(key);
      await db.execute(sql`INSERT INTO jev_cache(id,project_id,cache_key,model_version,response)
        VALUES(${id},${projectId},${key},${modelVersion},${JSON.stringify(parsed)}::jsonb)
        ON CONFLICT(project_id,cache_key) DO UPDATE SET
          model_version=excluded.model_version,response=excluded.response,expires_at=NULL`);
    },
  };
}
