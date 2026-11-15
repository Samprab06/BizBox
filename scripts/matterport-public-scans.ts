/**
 * HAC-137 (SIM-18): public-scan discovery for CoStar Matterport model IDs.
 *
 * Reads the distinct `matterportModelId`s on retail properties from
 * costar_attachments, checks at a polite rate whether each model embeds
 * publicly (public or unlisted), and records `is_public` + `checked_at` in
 * matterport_models. It never sets `display_approved`: showing a scan stays a
 * separate, reviewed decision.
 *
 *   pnpm exec tsx scripts/matterport-public-scans.ts --confirm-hac14 [--max-age-days 30] [--interval-ms 1000]
 *
 * GATE: this sends CoStar-derived model IDs to Matterport, so it refuses to run
 * without --confirm-hac14 (HAC-14's go-ahead). Output is aggregate counts only:
 * no model, property or space IDs are ever printed.
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { InteriorProvenance } from "../lib/contracts/interior";
import { matterportModels } from "../lib/db/matterport-schema";
import { isMain } from "./env-policy";

const MODEL_ID = /^[A-Za-z0-9]{11}$/;
const PROPERTY_ID = /^[0-9]+$/;
const SPACE_ID = /^[0-9]+:[0-9]+$/;
const DAY_MS = 86_400_000;
export const DEFAULT_MAX_AGE_DAYS = 30;
export const DEFAULT_INTERVAL_MS = 1_000;
export const MIN_INTERVAL_MS = 500;
export const CONFIRM_FLAG = "--confirm-hac14";

export type ScanCandidate = {
  modelId: string;
  propertyId: string;
  spaceId: string | null;
};
export type RegistryEntry = ScanCandidate & {
  id: string;
  isPublic: boolean | null;
  checkedAt: Date | null;
  /** Authored fixture rows (source.mode = synthetic) are never touched. */
  synthetic: boolean;
};
export type PublicCheckResult = "public" | "private" | "unknown";
export type PublicChecker = (modelId: string) => Promise<PublicCheckResult>;
export type RegistryWrite = typeof matterportModels.$inferInsert & {
  isPublic: boolean;
  checkedAt: Date;
};
export type DiscoveryDeps = {
  readCandidates(): Promise<ScanCandidate[]>;
  readRegistry(): Promise<RegistryEntry[]>;
  check: PublicChecker;
  write(rows: RegistryWrite[]): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): Date;
};

/** Same key as scripts/load-matterport.ts so both writers share one row per mapping. */
export function mappingId(m: ScanCandidate) {
  return createHash("sha256")
    .update(JSON.stringify([m.modelId, m.propertyId, m.spaceId]))
    .digest("hex");
}

/**
 * Validates and deduplicates mappings. When a model is attached to specific
 * spaces of a property, those space-scoped rows replace the property-level one.
 */
export function selectMappings(candidates: ScanCandidate[]) {
  const valid = new Map<string, ScanCandidate>();
  let invalid = 0;
  for (const c of candidates) {
    if (
      !MODEL_ID.test(c.modelId) ||
      !PROPERTY_ID.test(c.propertyId) ||
      (c.spaceId !== null && !SPACE_ID.test(c.spaceId))
    ) {
      invalid++;
      continue;
    }
    const m = {
      modelId: c.modelId,
      propertyId: c.propertyId,
      spaceId: c.spaceId,
    };
    valid.set(mappingId(m), m);
  }
  const spaced = new Set(
    [...valid.values()]
      .filter((m) => m.spaceId !== null)
      .map((m) => `${m.modelId}|${m.propertyId}`),
  );
  const mappings = [...valid.entries()]
    .filter(
      ([, m]) =>
        m.spaceId !== null || !spaced.has(`${m.modelId}|${m.propertyId}`),
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, m]) => ({ id, ...m }));
  return { mappings, invalid };
}

export function isStale(checkedAt: Date | null, now: Date, maxAgeDays: number) {
  return (
    checkedAt === null ||
    now.getTime() - checkedAt.getTime() > maxAgeDays * DAY_MS
  );
}

function provenance(scope: "space" | "property"): InteriorProvenance {
  return {
    origin: "costar",
    provider: "costar",
    mode: "live",
    scope,
    description:
      "Matterport model ID from a CoStar attachment; public-embed check recorded by HAC-137",
    limitations: [
      "Embed availability is a point-in-time check; owners can make scans private",
      "Not display-approved until reviewed",
    ],
  };
}

export async function discoverPublicScans(
  deps: DiscoveryDeps,
  options: { maxAgeDays?: number; intervalMs?: number } = {},
) {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    options.intervalMs ?? DEFAULT_INTERVAL_MS,
  );
  const now = deps.now();
  const { mappings, invalid } = selectMappings(await deps.readCandidates());
  const registry = new Map(
    (await deps.readRegistry()).map((row) => [row.id, row]),
  );

  // Rows per model: new candidate mappings plus existing non-synthetic rows
  // for the same model (so an older property-level row is kept current too).
  type Target = {
    id: string;
    candidate?: ScanCandidate;
    entry?: RegistryEntry;
  };
  const byModel = new Map<string, Target[]>();
  const add = (modelId: string, target: Target) =>
    byModel.set(modelId, [...(byModel.get(modelId) ?? []), target]);
  let skippedSynthetic = 0;
  for (const m of mappings) {
    const entry = registry.get(m.id);
    if (entry?.synthetic) {
      skippedSynthetic++;
      continue;
    }
    add(m.modelId, { id: m.id, candidate: m, entry });
  }
  const seen = new Set(mappings.map((m) => m.id));
  for (const entry of registry.values())
    if (!entry.synthetic && !seen.has(entry.id) && byModel.has(entry.modelId))
      add(entry.modelId, { id: entry.id, entry });

  const models = [...byModel.keys()].sort();
  const due = models.filter((modelId) =>
    byModel
      .get(modelId)!
      .some((t) => isStale(t.entry?.checkedAt ?? null, now, maxAgeDays)),
  );

  const counts = { public: 0, private: 0, unknown: 0 };
  const writes: RegistryWrite[] = [];
  for (const [index, modelId] of due.entries()) {
    if (index > 0) await deps.sleep(intervalMs);
    let result: PublicCheckResult;
    try {
      result = await deps.check(modelId);
    } catch {
      result = "unknown";
    }
    counts[result]++;
    // An inconclusive check writes nothing, so the model stays due next run.
    if (result === "unknown") continue;
    for (const t of byModel.get(modelId)!) {
      const m = t.candidate ?? t.entry!;
      writes.push({
        id: t.id,
        modelId: m.modelId,
        costarPropertyId: m.propertyId,
        costarSpaceId: m.spaceId,
        hasExterior: null,
        source: provenance(m.spaceId === null ? "property" : "space"),
        displayApproved: false,
        isPublic: result === "public",
        checkedAt: now,
      });
    }
  }
  if (writes.length > 0) await deps.write(writes);

  return {
    mappings: mappings.length,
    spaceScoped: mappings.filter((m) => m.spaceId !== null).length,
    invalidCandidates: invalid,
    skippedSynthetic,
    models: models.length,
    fresh: models.length - due.length,
    checked: due.length,
    public: counts.public,
    private: counts.private,
    unknown: counts.unknown,
    rowsWritten: writes.length,
  };
}

/**
 * Matterport's oEmbed endpoint answers only for models that can be embedded
 * without credentials (public or unlisted). Private or removed models are
 * refused; anything else is inconclusive and retried on the next run.
 */
export function createOEmbedChecker(
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): PublicChecker {
  return async (modelId) => {
    if (!MODEL_ID.test(modelId)) return "unknown";
    const show = `https://my.matterport.com/show/?m=${modelId}`;
    const url = `https://my.matterport.com/api/v1/models/oembed/?url=${encodeURIComponent(show)}`;
    const response = await fetcher(url, {
      redirect: "manual",
      headers: {
        accept: "application/json",
        "user-agent": "bizbox-scan-check",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    if (response.status === 200) return "public";
    if ([401, 403, 404, 410].includes(response.status)) return "private";
    return "unknown";
  };
}

type Executor = {
  execute(query: ReturnType<typeof sql>): PromiseLike<unknown>;
};
const list = (value: unknown) =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** Retail property = at least one active Retail/OfficeRetail lease space (as in costar-3d-report). */
export async function readPostgresCandidates(db: Executor) {
  const rows = list(
    await db.execute(sql`
      SELECT DISTINCT a.data->>'matterportModelId' AS model_id,
             a.property_id,
             s.id AS space_id
      FROM costar_attachments a
      LEFT JOIN costar_spaces s
        ON a.source->>'dataset' = 'commercial-listing-summary'
       AND s.listing_id = a.source->>'recordId'
       AND s.property_id = a.property_id
       AND s.source->>'field' =
           substring(a.source->>'field' from '^(forLeaseSummary\\.spaces\\[[0-9]+\\])\\.') || '.id'
      WHERE a.data->>'matterportModelId' ~ '^[A-Za-z0-9]{11}$'
        AND a.property_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM costar_spaces r
          WHERE r.property_id = a.property_id AND r.active AND r.retail
        )
    `),
  );
  return rows.map((r) => ({
    modelId: String(r.model_id),
    propertyId: String(r.property_id),
    spaceId: typeof r.space_id === "string" ? r.space_id : null,
  }));
}

export async function readPostgresRegistry(
  db: Executor,
): Promise<RegistryEntry[]> {
  const rows = list(
    await db.execute(sql`
      SELECT id, model_id, costar_property_id, costar_space_id, is_public, checked_at,
             source->>'mode' AS mode
      FROM matterport_models
    `),
  );
  return rows.map((r) => ({
    id: String(r.id),
    modelId: String(r.model_id),
    propertyId: String(r.costar_property_id),
    spaceId: typeof r.costar_space_id === "string" ? r.costar_space_id : null,
    isPublic: typeof r.is_public === "boolean" ? r.is_public : null,
    checkedAt: r.checked_at == null ? null : new Date(String(r.checked_at)),
    synthetic: r.mode === "synthetic",
  }));
}

export async function runPublicScanDiscovery(
  databaseUrl: string,
  options: { maxAgeDays?: number; intervalMs?: number; check?: PublicChecker },
) {
  const protocol = new URL(databaseUrl).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:")
    throw new Error("PostgreSQL is required");
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const db = drizzle(client);
  try {
    return await discoverPublicScans(
      {
        readCandidates: () => readPostgresCandidates(db),
        readRegistry: () => readPostgresRegistry(db),
        check: options.check ?? createOEmbedChecker(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => new Date(),
        write: (rows) =>
          db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(481196)`);
            for (const row of rows)
              // Only the check result changes on an existing row: approval,
              // provenance and cached dimensions stay as they were.
              await tx
                .insert(matterportModels)
                .values(row)
                .onConflictDoUpdate({
                  target: matterportModels.id,
                  set: { isPublic: row.isPublic, checkedAt: row.checkedAt },
                  setWhere: sql`${matterportModels.source}->>'mode' IS DISTINCT FROM 'synthetic'`,
                });
          }),
      },
      options,
    );
  } finally {
    await client.end();
  }
}

export type CliPlan =
  | { ok: true; maxAgeDays: number; intervalMs: number }
  | { ok: false; message: string };

export function parseCliArgs(args: string[]): CliPlan {
  if (!args.includes(CONFIRM_FLAG))
    return {
      ok: false,
      message: `Refusing to run: this sends CoStar-derived Matterport model IDs to Matterport and needs HAC-14's go-ahead. Re-run with ${CONFIRM_FLAG} only once HAC-14 has approved it. Nothing was read or sent.`,
    };
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let intervalMs = DEFAULT_INTERVAL_MS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === CONFIRM_FLAG) continue;
    const value = Number(args[i + 1]);
    if (arg === "--max-age-days" && Number.isFinite(value) && value >= 0) {
      maxAgeDays = value;
      i++;
    } else if (
      arg === "--interval-ms" &&
      Number.isInteger(value) &&
      value >= MIN_INTERVAL_MS
    ) {
      intervalMs = value;
      i++;
    } else
      return {
        ok: false,
        message: `Usage: ${CONFIRM_FLAG} [--max-age-days N>=0] [--interval-ms N>=${MIN_INTERVAL_MS}]`,
      };
  }
  return { ok: true, maxAgeDays, intervalMs };
}

if (isMain(import.meta.url)) {
  const plan = parseCliArgs(process.argv.slice(2));
  if (!plan.ok) {
    console.error(plan.message);
    process.exitCode = 1;
  } else {
    // Environment files load only after the explicit HAC-14 confirmation.
    config({ path: [".env.local", ".env"], quiet: true });
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error(
        "Set DATABASE_URL to the database with the CoStar kit loaded.",
      );
      process.exitCode = 1;
    } else {
      runPublicScanDiscovery(url, plan)
        .then((result) => console.log(JSON.stringify(result)))
        .catch(() => {
          console.error(
            "Public-scan discovery failed; check the migration and database configuration. No source records were printed.",
          );
          process.exitCode = 1;
        });
    }
  }
}
