import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createCatchmentIndexes } from "./create-catchment-indexes";
import { fetchPublicData } from "./fetch-public-data";
import { loadKit } from "./load-costar";

/**
 * HAC-44: migrate and load a hosted database (Neon). It is separate from the local-only
 * `db:load` on purpose: it needs an explicit `--confirm-hosted` flag and a direct
 * (unpooled) connection, and it never prints the connection string.
 *
 * It skips costar_attachments (no runtime route reads it; the full load exceeds a 1 GB
 * cluster limit with it) and reuses the verified public-data download cache.
 */

export const HOSTED_TABLES = [
  "costar_properties",
  "costar_spaces",
  "costar_tenancies",
  "costar_attachments",
  "public_block_groups",
  "public_jobs",
  "public_places",
] as const;
export type HostedRowCounts = Record<(typeof HOSTED_TABLES)[number], number>;

export const EXPECTED_HOSTED_COUNTS: Partial<HostedRowCounts> = {
  costar_properties: 3339,
  costar_spaces: 3955,
  costar_attachments: 0,
  public_block_groups: 12816,
};

/** Removes connection strings and Neon passwords from a diagnostic message. */
export function redact(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<redacted-url>")
    .replace(/npg_[A-Za-z0-9]+/g, "<redacted>")
    .replace(/password[^,;\s]*/gi, "<redacted>");
}

export function assertHostedTarget(url: string, argv: readonly string[]): void {
  if (!argv.includes("--confirm-hosted"))
    throw new Error("db:load:hosted needs --confirm-hosted");
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("db:load:hosted needs a PostgreSQL URL");
  if (["127.0.0.1", "localhost", "[::1]", "db"].includes(parsed.hostname))
    throw new Error(
      "db:load:hosted is for hosted targets; use db:load locally",
    );
  if (parsed.hostname.includes("-pooler."))
    throw new Error("db:load:hosted needs the direct (unpooled) connection");
}

export function verifyHostedCounts(counts: HostedRowCounts): void {
  for (const table of HOSTED_TABLES) {
    if (table === "costar_attachments") continue;
    if (!(counts[table] > 0))
      throw new Error(`No complete source inventory in ${table}`);
  }
  for (const [table, expected] of Object.entries(EXPECTED_HOSTED_COUNTS)) {
    if (counts[table as keyof HostedRowCounts] !== expected)
      throw new Error(`Unexpected ${table} count: expected ${expected}`);
  }
}

async function rowCounts(url: string): Promise<HostedRowCounts> {
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
  try {
    const entries = [];
    for (const table of HOSTED_TABLES) {
      const [row] = await client<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM ${client(table)}`;
      entries.push([table, Number(row?.count)]);
    }
    return Object.fromEntries(entries) as HostedRowCounts;
  } finally {
    await client.end();
  }
}

export async function loadHostedData(
  url: string,
  options: { publicCache?: string } = {},
) {
  console.log("[db:load:hosted] Applying application migrations");
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    // The demo project the workspace screens use; project-scoped routes need it.
    await client`INSERT INTO projects(id,name) VALUES('houston-coffee','Houston coffee (demo)') ON CONFLICT(id) DO NOTHING`;
  } finally {
    await client.end();
  }
  console.log(
    "[db:load:hosted] Replacing CoStar source observations (attachments counted, not stored)",
  );
  const costar = await loadKit(resolve("costar-hackathon-kit"), url, {
    skipAttachments: true,
    batchSize: 25,
  });
  console.log(JSON.stringify({ phase: "costar", ...costar.counts }));
  console.log(
    "[db:load:hosted] Replacing public observations from the keyless cache",
  );
  const publicData = await fetchPublicData({
    acsSource: "summary",
    databaseUrl: url,
    batchSizes: { blockGroups: 20, jobs: 250, places: 100 },
    ...(options.publicCache ? { cache: options.publicCache } : {}),
  });
  console.log(JSON.stringify({ phase: "public", ...publicData }));
  console.log("[db:load:hosted] Ensuring catchment geography indexes");
  await createCatchmentIndexes(url);
  const counts = await rowCounts(url);
  verifyHostedCounts(counts);
  console.log(
    JSON.stringify({ mode: "verified-hosted-load", counts }, null, 2),
  );
  return counts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = (
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  )?.trim();
  const cacheArg = process.argv.find((a) => a.startsWith("--public-cache="));
  try {
    if (!url)
      throw new Error(
        "Set DATABASE_URL_UNPOOLED (direct Neon connection) in .env.local",
      );
    assertHostedTarget(url, process.argv);
    loadHostedData(
      url,
      cacheArg
        ? { publicCache: resolve(cacheArg.slice("--public-cache=".length)) }
        : {},
    ).catch((error: unknown) => {
      console.error(
        "Hosted load failed. Each source import is atomic; rerunning replaces the data.",
      );
      // Driver errors can contain credentials: print only our own diagnostics.
      if (
        error instanceof Error &&
        /^(Unexpected .* count:|No complete source inventory)/.test(
          error.message,
        )
      )
        console.error(error.message);
      else if (error instanceof Error) {
        // Drizzle's "Failed query" message embeds every parameter; report the driver cause only.
        const cause = (error as { cause?: { code?: string; message?: string } })
          .cause;
        const message =
          cause?.message ?? error.message.split("\n")[0]!.slice(0, 200);
        console.error(
          `(${error.name}${cause?.code ? ` ${cause.code}` : ""}) ${redact(message)}`,
        );
      }
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid configuration",
    );
    process.exitCode = 1;
  }
}
