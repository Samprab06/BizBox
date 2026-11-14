import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { MatterportManifestSchema } from "../lib/contracts/interior";
import { matterportModels } from "../lib/db/matterport-schema";
import { isMain } from "./env-policy";

/** The private zip adapter is deliberately deferred until HAC-14 defines it. */
export function normalizeMatterportManifest(input: unknown) {
  const manifest = MatterportManifestSchema.parse(input);
  const mappings = new Map<string, typeof matterportModels.$inferInsert>();
  for (const model of manifest.models) {
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          model.modelId,
          model.costarPropertyId,
          model.costarSpaceId,
        ]),
      )
      .digest("hex");
    const row: typeof matterportModels.$inferInsert = {
      id,
      modelId: model.modelId,
      costarPropertyId: model.costarPropertyId,
      costarSpaceId: model.costarSpaceId,
      hasExterior: model.hasExterior,
      source: model.source,
      displayApproved: false,
      dimensions: model.dimensions ?? null,
      dimensionsRecordedAt: model.dimensionsRecordedAt
        ? new Date(model.dimensionsRecordedAt)
        : null,
    };
    const prior = mappings.get(id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row))
      throw new Error("Conflicting duplicate model mapping");
    mappings.set(id, row);
  }
  return [...mappings.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** No URL means offline/report-only; no import ever fetches external sources. */
export async function loadMatterport(path: string, databaseUrl?: string) {
  const rows = normalizeMatterportManifest(
    JSON.parse(await readFile(path, "utf8")),
  );
  const counts = {
    mappings: rows.length,
    models: new Set(rows.map((row) => row.modelId)).size,
    cachedDimensions: rows.filter((row) => row.dimensions !== null).length,
  };
  if (!databaseUrl) return { mode: "report-only", ...counts };
  const protocol = new URL(databaseUrl).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:")
    throw new Error("PostgreSQL is required");
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    await drizzle(client).transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(481196)`);
      for (const row of rows) {
        // Metadata import never authorizes display or destroys an existing cache.
        // Supplied dimensions refresh only the same model/property/space tuple.
        await tx
          .insert(matterportModels)
          .values(row)
          .onConflictDoUpdate({
            target: matterportModels.id,
            set: {
              hasExterior: row.hasExterior,
              source: row.source,
              ...(row.dimensions
                ? {
                    dimensions: row.dimensions,
                    dimensionsRecordedAt: row.dimensionsRecordedAt,
                  }
                : {}),
            },
          });
      }
    });
    return { mode: "loaded", ...counts };
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  const write = args.includes("--write");
  // Offline validation must not even load private environment files.
  if (write) config({ path: [".env.local", ".env"], quiet: true });
  if (
    !path ||
    args.some(
      (arg) =>
        arg.startsWith("--") && arg !== "--write" && arg !== "--report-only",
    ) ||
    (write && (args.includes("--report-only") || !process.env.DATABASE_URL))
  ) {
    console.error(
      "Provide a manifest path; use --write with an approved DATABASE_URL to import, or --report-only for offline validation.",
    );
    process.exitCode = 1;
  } else {
    loadMatterport(path, write ? process.env.DATABASE_URL : undefined)
      .then((result) => console.log(JSON.stringify(result)))
      .catch(() => {
        console.error(
          "Matterport import failed; check the manifest, migration and database configuration. No source records were printed.",
        );
        process.exitCode = 1;
      });
  }
}
