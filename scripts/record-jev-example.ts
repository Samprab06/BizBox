import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MemoryJevCache, type JevCache } from "../lib/panel/cache";
import type {
  CandidateSite,
  Competitor,
  NeedSpec,
} from "../lib/panel/contracts";
import {
  createJevClientFromEnv,
  type JevClient,
} from "../lib/panel/jev-client";
import { DEFAULT_ORDERS, runPanelForSites } from "../lib/panel/panel";
import { buildPersonas } from "../lib/panel/personas";
import {
  RECORDED_EXAMPLE_FILE,
  RecordedJevExampleSchema,
  recordedExampleIssues,
  type RecordedJevExample,
} from "../lib/panel/recorded-example";
import { catchment } from "../lib/panel/__fixtures__";
import { isMain } from "./env-policy";

/**
 * HAC-101: records one full Jev panel for the Montrose example (every persona x the example
 * sites and competitors) and writes it as the behavior-table fixture the example comparison
 * reads. It costs real Jev calls, so it runs only when JEV_API_KEY is set; without the key it
 * prints why and exits without touching any file.
 *
 *   pnpm jev:record                run the panel and write lib/panel/__fixtures__/jev-montrose-example.json
 *   pnpm jev:record --dry-run      print the plan and call count; needs no key, calls nothing
 *   pnpm jev:record --force        replace an existing recording
 *   pnpm jev:record --out <path>   write somewhere else
 *
 * Before committing the output, confirm the TypeSafe terms allow checking in recorded answers
 * (HAC-14). If they do not, leave the file out of git: the example then keeps its Huff numbers.
 */

/** Orders each persona is asked per site, as in live runs. */
export const RECORD_ORDERS = DEFAULT_ORDERS;

export const EXAMPLE_NEED: NeedSpec = {
  businessType: "coffee",
  priceUsd: 6.5,
  serviceMinPerCustomer: 4,
};

/** The two example sites (ids match `getPreviewProject`), both asked about the Montrose-area personas. */
export const EXAMPLE_SITES: {
  site: CandidateSite;
  sizeSqft: number;
  position: "inline" | "corner";
}[] = [
  {
    site: {
      ...catchment.site,
      id: "montrose",
      frontage: "corner",
      hasParking: false,
    },
    sizeSqft: 1450,
    position: "corner",
  },
  {
    site: {
      id: "heights",
      lat: catchment.site.lat + 0.012,
      lng: catchment.site.lng - 0.008,
      frontage: "inline",
      opensMin: 420,
      hasParking: true,
    },
    sizeSqft: 1820,
    position: "inline",
  },
];

export function plannedCalls(
  personaCount: number,
  siteCount = EXAMPLE_SITES.length,
  orders = RECORD_ORDERS,
) {
  return personaCount * siteCount * orders;
}

export interface RecordOptions {
  client: JevClient;
  cache?: JevCache;
  now?: () => Date;
  orders?: number;
}

/** Runs the panel and returns the recording; throws if any persona is still unanswered. */
export async function recordJevExample(
  options: RecordOptions,
): Promise<RecordedJevExample> {
  const personaSet = buildPersonas(catchment);
  const competitors: Competitor[] = catchment.competitors;
  const orders = options.orders ?? RECORD_ORDERS;
  const { tables, stats } = await runPanelForSites({
    personaSet,
    sites: EXAMPLE_SITES.map((s) => s.site),
    competitors,
    need: EXAMPLE_NEED,
    client: options.client,
    cache: options.cache ?? new MemoryJevCache(),
    orders,
  });
  const recorded: RecordedJevExample = RecordedJevExampleSchema.parse({
    schemaVersion: 1,
    recordedAt: (options.now?.() ?? new Date()).toISOString(),
    modelVersion: tables[0]?.modelVersion ?? options.client.modelVersion,
    need: EXAMPLE_NEED,
    personaSet,
    competitors,
    sites: EXAMPLE_SITES.map(({ site, sizeSqft, position }) => ({
      siteId: site.id,
      storefront: {
        id: site.id,
        location: { lat: site.lat, lng: site.lng },
        sizeSqft,
        position,
        frontageFt: 30,
        anchorCoTenants: 0,
        origin: "default",
      },
      table: tables.find((t) => t.siteId === site.id),
    })),
    panel: {
      orders,
      calls: stats.calls,
      retriedCalls: stats.retriedCalls,
      failedCalls: stats.failedCalls,
    },
  });
  const issues = recordedExampleIssues(recorded);
  if (issues.length)
    throw new Error(
      `Panel incomplete after one retry per call: ${issues.join("; ")}`,
    );
  return recorded;
}

export interface MainIo {
  log: (message: string) => void;
  error: (message: string) => void;
  /** Injected in tests; defaults to the real Jev client built from the environment. */
  client?: JevClient;
  now?: () => Date;
}

/** Returns the process exit code. Writes the output file only after a complete, valid recording. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  io: MainIo = { log: console.log, error: console.error },
): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const outIndex = argv.indexOf("--out");
  const out = resolve(
    outIndex >= 0 && argv[outIndex + 1]
      ? argv[outIndex + 1]!
      : RECORDED_EXAMPLE_FILE,
  );

  const personaCount = buildPersonas(catchment).personas.length;
  const total = plannedCalls(personaCount);
  if (dryRun) {
    io.log(
      `Dry run: ${personaCount} personas x ${EXAMPLE_SITES.length} sites x ${RECORD_ORDERS} orders = up to ${total} Jev calls ` +
        `(each failed call is retried once). Would write ${out}. Nothing was called or written.`,
    );
    return 0;
  }

  if (!env.JEV_API_KEY?.trim()) {
    io.error(
      "JEV_API_KEY is not set, so nothing was recorded and no file was changed. " +
        `Recording the Montrose example makes up to ${total} paid Jev calls. ` +
        "Set JEV_API_KEY in your shell (never in a committed file) and run `pnpm jev:record`, " +
        "or use --dry-run to see the plan.",
    );
    return 1;
  }
  if (existsSync(out) && !force) {
    io.error(
      `${out} already exists. Run with --force to replace it. Nothing was called or written.`,
    );
    return 1;
  }

  let recorded: RecordedJevExample;
  try {
    recorded = await recordJevExample({
      client: io.client ?? createJevClientFromEnv(env),
      ...(io.now ? { now: io.now } : {}),
    });
  } catch (error) {
    io.error(
      `Recording failed; no file was written. ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(recorded, null, 2)}\n`);
  io.log(
    `Recorded ${recorded.personaSet.personas.length} personas x ${recorded.sites.length} sites with ${recorded.modelVersion} ` +
      `(${recorded.panel.calls} Jev calls, ${recorded.panel.retriedCalls} retried) to ${out}. ` +
      "Confirm the TypeSafe terms allow checking in recorded answers (HAC-14) before committing it.",
  );
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
