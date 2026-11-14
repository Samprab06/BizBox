import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadKit } from "./load-costar";
import { fetchPublicData } from "./fetch-public-data";
import { createCatchmentIndexes } from "./create-catchment-indexes";

export const SOURCE_TABLES = [
  "costar_properties",
  "costar_spaces",
  "costar_tenancies",
  "costar_attachments",
  "public_block_groups",
  "public_jobs",
  "public_places",
] as const;
export type LocalRowCounts = Record<(typeof SOURCE_TABLES)[number], number>;

/** This convenience loader is intentionally unable to mutate a hosted target. */
export function assertLocalDatabase(url: string): void {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]", "db"].includes(parsed.hostname)
  ) {
    throw new Error(
      "db:load is local-only; configure a localhost or Compose db DATABASE_URL",
    );
  }
}

export function verifyLocalCounts(counts: LocalRowCounts): void {
  for (const table of SOURCE_TABLES) {
    if (!Number.isSafeInteger(counts[table]) || counts[table] <= 0)
      throw new Error(`No complete source inventory in ${table}`);
  }
  for (const [table, expected] of Object.entries({
    costar_properties: 3339,
    costar_spaces: 3955,
    public_block_groups: 12816,
  })) {
    if (counts[table as keyof LocalRowCounts] !== expected)
      throw new Error(
        `Unexpected ${table} count: expected pinned inventory ${expected}`,
      );
  }
}

export async function localRowCounts(url: string): Promise<LocalRowCounts> {
  assertLocalDatabase(url);
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const entries = [];
    for (const table of SOURCE_TABLES) {
      const [row] = await client<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM ${client(table)}`;
      entries.push([table, Number(row?.count)]);
    }
    return Object.fromEntries(entries) as LocalRowCounts;
  } finally {
    await client.end();
  }
}

export async function loadLocalData(url: string) {
  assertLocalDatabase(url);
  console.log("[db:load] Applying application migrations");
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await client`INSERT INTO projects(id,name) VALUES('local-dev','Local development') ON CONFLICT(id) DO NOTHING`;
  } finally {
    await client.end();
  }
  console.log("[db:load] Replacing licensed CoStar source observations");
  const costar = await loadKit(resolve("costar-hackathon-kit"), url);
  console.log(JSON.stringify({ phase: "costar", ...costar.counts }));
  console.log(
    "[db:load] Preparing cached keyless ACS/TIGER, LODES and Overture, then replacing public observations",
  );
  const publicData = await fetchPublicData({
    acsSource: "summary",
    databaseUrl: url,
  });
  console.log(JSON.stringify({ phase: "public", ...publicData }));
  console.log("[db:load] Ensuring catchment geography indexes");
  await createCatchmentIndexes(url);
  const counts = await localRowCounts(url);
  verifyLocalCounts(counts);
  console.log(JSON.stringify({ mode: "verified-local-load", counts }, null, 2));
  return counts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  config({ path: [".env.local", ".env"], quiet: true });
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "Set a local DATABASE_URL in .env.local; see docs/local-postgis.md",
    );
    process.exitCode = 1;
  } else
    loadLocalData(process.env.DATABASE_URL).catch((error: unknown) => {
      console.error(
        "Local load failed. Completed imports remain atomic per source; rerun reuses verified download caches.",
      );
      // Only our count/local-target diagnostics are safe to print; driver errors can contain credentials.
      if (
        error instanceof Error &&
        /^(Unexpected .* count:|No complete source inventory|db:load is local-only)/.test(
          error.message,
        )
      )
        console.error(error.message);
      process.exitCode = 1;
    });
}
