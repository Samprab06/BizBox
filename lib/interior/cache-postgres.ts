import "server-only";
import { sql } from "drizzle-orm";
import type { getDb } from "../db/client";
import { InteriorDimensionsSchema } from "../contracts/interior";
import type { MatterportModelClient } from "./model-api";
import type { InteriorDimensionsProvider } from "./service";

type Database = ReturnType<typeof getDb>;

/** Explicitly injected approved provider only; no env reads or implicit network. */
export function createPostgresDimensionsProvider(
  db: Database,
  client: MatterportModelClient,
): InteriorDimensionsProvider {
  return async (mapping) => {
    try {
      return await db.transaction(async (tx) => {
        // Serialize misses for a model across its mappings without a queue or
        // retries. A concurrent warmer returns no geometry for this request.
        const lock = await tx.execute<{ locked: boolean }>(sql`
          SELECT pg_try_advisory_xact_lock(hashtext(${`matterport:${mapping.modelId}`})) AS locked
        `);
        if (lock[0]?.locked !== true) return;
        const records = await tx.execute<{ dimensions: unknown }>(sql`
          SELECT dimensions FROM matterport_models
          WHERE model_id=${mapping.modelId} AND costar_property_id=${mapping.propertyId}
            AND costar_space_id IS NOT DISTINCT FROM ${mapping.spaceId} AND display_approved=true
          LIMIT 1 FOR UPDATE
        `);
        const record = records[0];
        if (!record) return;
        if (record.dimensions !== null) {
          const cached = InteriorDimensionsSchema.safeParse(record.dimensions);
          return cached.success ? cached.data : undefined;
        }
        const dimensions = InteriorDimensionsSchema.safeParse(
          await client.getDimensions(mapping.modelId),
        );
        if (!dimensions.success) return;
        await tx.execute(sql`
          UPDATE matterport_models SET dimensions=${JSON.stringify(dimensions.data)}::jsonb, dimensions_recorded_at=now()
          WHERE model_id=${mapping.modelId} AND costar_property_id=${mapping.propertyId}
            AND costar_space_id IS NOT DISTINCT FROM ${mapping.spaceId} AND display_approved=true
        `);
        return dimensions.data;
      });
    } catch {
      return;
    } // Failed/partial reads never replace a stored cache.
  };
}
