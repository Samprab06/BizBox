/**
 * Jev customer panel: asks every persona about one candidate site and aggregates the answers
 * into a `BehaviorTable`.
 *
 * Each persona x site is asked `orders` times (default 4), each time with the Choice options
 * (`where`, `when`) in a different seeded shuffle; all answers are averaged and the spread of
 * `where` between orders is reported. Every call's answer is written to the cache as soon as it
 * arrives, so a run cut off by a time limit resumes from the cache and an unchanged rerun
 * makes zero Jev calls. A call that fails is retried once (`retries`, default 1) before its
 * persona is reported as failed; answers that already arrived are never asked for again.
 */
import { createRng } from "@/lib/sim/random";
import {
  ASKED_LINE_LENGTHS,
  BehaviorTableSchema,
  TIME_BLOCKS,
  type BehaviorTable,
  type CandidateSite,
  type Competitor,
  type NeedSpec,
  type PersonaBehavior,
  type PersonaSet,
  type TimeBlock,
} from "./contracts";
import { CacheWriter, jevCacheKey, readCache, type JevCache } from "./cache";
import type { JevAskRequest, JevAskResult, JevClient } from "./jev-client";
import {
  HOW_OFTEN_LEVELS,
  VISITS_PER_MONTH,
  buildBundledQuestions,
  buildQuestions,
  buildState,
  priceQuestionName,
  pricePoints,
  stayQuestionName,
  whenOrderQuestionName,
  whereOptionIds,
  whereOrderQuestionName,
  type PanelContext,
} from "./state";

export const DEFAULT_ORDERS = 4;
/** Extra attempts for a Jev call that failed (the HTTP client has its own transport retries). */
export const DEFAULT_RETRIES = 1;

export interface RunPanelOptions {
  personaSet: PersonaSet;
  site: CandidateSite;
  competitors: Competitor[];
  need: NeedSpec;
  client: JevClient;
  cache: JevCache;
  /** Seed for the option-order shuffles. Default 0. */
  seed?: number | string;
  /** Shuffled orders per persona. Default 4. */
  orders?: number;
  /**
   * Send the shuffled orders as separate Choice questions in one request per persona x site
   * (`where_o0..`, `when_o0..`) instead of one request per order. 4x fewer requests and about
   * 2.8x fewer tokens, but the answers differ slightly, so it is off until validated against
   * live Jev (JEV_BUNDLE_ORDERS). Default false.
   */
  bundleOrders?: boolean;
  /** Retries per failed call before the persona is given up on. Default 1. */
  retries?: number;
  pricePoints?: number[];
  /** Called after each persona finishes (for progress reporting). */
  onPersona?: (personaId: string, ok: boolean) => void;
  /** Epoch deadline. Stop scheduling new Jev work before this time; cached answers remain reusable. */
  deadlineAt?: number;
  /** Reserve time for one in-flight provider wave and its cache flush (default 20 seconds). */
  deadlineReserveMs?: number;
  signal?: AbortSignal;
}

export interface PanelStats {
  /** Jev calls actually sent (cache misses), retries included. */
  calls: number;
  cacheHits: number;
  /** Calls that still failed after their retries. */
  failedCalls: number;
  /** Retry attempts sent after a first failure (already counted in `calls`). */
  retriedCalls: number;
  elapsedMs: number;
}

export interface PanelRun {
  table: BehaviorTable;
  stats: PanelStats;
  progress?: { completedPersonas: number; totalPersonas: number; inProgress: boolean };
}

/** One planned Jev call for a persona: the order index and the request. */
interface PlannedCall {
  order: number;
  request: JevAskRequest;
  /** True when the request carries every order (`where_o0..`) rather than just this one. */
  bundled?: boolean;
}

/**
 * Plans the Jev calls per persona. Unbundled (default): one call per order, each with its own
 * shuffled `where`/`when`. Bundled: a single call per persona carrying every order.
 */
export function planCalls(personaSet: PersonaSet, ctx: PanelContext, seed: number | string, orders: number, bundle = false) {
  const root = createRng(seed);
  return personaSet.personas.map((persona) => {
    const calls: PlannedCall[] = [];
    if (bundle) {
      const rng = root.fork(`${persona.id}|${ctx.site.id}|bundle`);
      const { questions, whereOrder } = buildBundledQuestions(ctx, rng, orders);
      calls.push({ order: 0, bundled: true, request: { state: buildState(persona, ctx, whereOrder), questions } });
      return { persona, calls };
    }
    for (let order = 0; order < orders; order++) {
      const rng = root.fork(`${persona.id}|${ctx.site.id}|order${order}`);
      const { questions, whereOrder } = buildQuestions(ctx, rng);
      calls.push({ order, request: { state: buildState(persona, ctx, whereOrder), questions } });
    }
    return { persona, calls };
  });
}

/**
 * Splits a bundled answer into one view per order: order i sees `where_o{i}` and `when_o{i}`
 * as `where` and `when`, and the shared answers as they are. `aggregate` then averages them
 * exactly as it averages separate calls, so its mean and spread keep their meaning.
 */
export function expandBundled(result: JevAskResult, orders: number): JevAskResult[] {
  return Array.from({ length: orders }, (_, i) => {
    const answers = { ...result.answers };
    for (const [base, name] of [
      ["where", whereOrderQuestionName(i)],
      ["when", whenOrderQuestionName(i)],
    ] as const) {
      const a = result.answers[name];
      if (a) answers[base] = a;
    }
    return { modelVersion: result.modelVersion, answers };
  });
}

type KeyedCall = PlannedCall & { key: string };

interface SitePlan {
  opts: RunPanelOptions;
  ctx: PanelContext;
  orders: number;
  retries: number;
  plan: { persona: PersonaSet["personas"][number]; calls: KeyedCall[] }[];
}

async function planSite(opts: RunPanelOptions): Promise<SitePlan> {
  const ctx: PanelContext = {
    site: opts.site,
    competitors: opts.competitors,
    need: opts.need,
    pricePoints: opts.pricePoints,
  };
  const orders = Math.max(1, opts.orders ?? DEFAULT_ORDERS);
  const retries = Math.max(0, Math.floor(opts.retries ?? DEFAULT_RETRIES));
  const modelVersion = opts.client.modelVersion;
  const planned = planCalls(opts.personaSet, ctx, opts.seed ?? 0, orders, opts.bundleOrders ?? false);
  const plan = await Promise.all(
    planned.map(async ({ persona, calls }) => ({
      persona,
      calls: await Promise.all(calls.map(async (c) => ({ ...c, key: await jevCacheKey(modelVersion, c.request) }))),
    })),
  );
  return { opts, ctx, orders, retries, plan };
}

interface SharedRun {
  /** Everything the cache already holds for this run's keys, read in one batch. */
  known: Map<string, JevAskResult>;
  writer: CacheWriter;
  failed: Set<string>;
  pending: Set<string>;
  stats: Map<SitePlan, PanelStats>;
}

async function execSite(sp: SitePlan, shared: SharedRun): Promise<PanelRun> {
  const started = performance.now();
  const { opts, ctx, orders, retries } = sp;
  const modelVersion = opts.client.modelVersion;
  const stats = shared.stats.get(sp)!;
  const answeredVersions = new Set<string>();

  const outcomes = await Promise.all(
    sp.plan.map(async ({ persona, calls }) => {
      const settled = await Promise.allSettled(
        calls.map(async (call) => {
          const hit = shared.known.get(call.key);
          if (hit) {
            stats.cacheHits++;
            answeredVersions.add(hit.modelVersion);
            return { call, result: hit };
          }
          if (shared.pending.has(call.key)) return { call, pending: true };
          if (shared.failed.has(call.key)) throw new Error("Jev call failed");
          throw new Error("Unscheduled Jev call");
        }),
      );
      const pending = settled.some((s) => s.status === "fulfilled" && "pending" in s.value);
      const ok = !pending && settled.every((s) => s.status === "fulfilled");
      if (!pending) opts.onPersona?.(persona.id, ok);
      if (!ok) return { personaId: persona.id, behavior: undefined, pending };
      const answers = settled.map((s) => (s as PromiseFulfilledResult<{ call: KeyedCall; result: JevAskResult }>).value);
      const views = answers.flatMap((a) => (a.call.bundled ? expandBundled(a.result, orders) : [a.result]));
      return {
        personaId: persona.id,
        behavior: aggregate(
          persona.id,
          ctx,
          views,
          answers.map((a) => a.call.key),
        ),
      };
    }),
  );

  // Record the version Jev actually answered with (e.g. jev-1.14.0), not the requested alias.
  // Sorted, not first-arrived, so a mix of versions (cached and fresh answers across an alias
  // roll) gives the same table in any response-arrival order (HAC-131).
  const answered: string | undefined = [...answeredVersions].sort()[0];
  const table: BehaviorTable = {
    siteId: opts.site.id,
    modelVersion: answered ?? modelVersion,
    personas: outcomes.flatMap((o) => (o.behavior ? [o.behavior] : [])),
    failedPersonaIds: outcomes.filter((o) => !o.behavior && !o.pending).map((o) => o.personaId),
  };
  stats.elapsedMs = performance.now() - started;
  return { table: BehaviorTableSchema.parse(table), stats, progress: {
    completedPersonas: outcomes.filter((o) => Boolean(o.behavior) || !o.pending).length,
    totalPersonas: outcomes.length,
    inProgress: outcomes.some((o) => o.pending),
  } };
}

/** One batched cache read for every key of `plans`, then run them all against one shared writer. */
async function runPlans(plans: SitePlan[]): Promise<PanelRun[]> {
  const cache = plans[0]!.opts.cache;
  const known = await readCache(cache, plans.flatMap((sp) => sp.plan.flatMap((p) => p.calls.map((c) => c.key))));
  const writer = new CacheWriter(cache);
  const failed = new Set<string>();
  const pending = new Set<string>();
  const stats = new Map(plans.map((sp) => [sp, { calls: 0, cacheHits: 0, failedCalls: 0, retriedCalls: 0, elapsedMs: 0 }]));
  try {
    const missing = plans.flatMap((sp) => sp.plan.flatMap((p) => p.calls.map((call) => ({ sp, call }))))
      .filter(({ call }) => !known.has(call.key));
    // A bounded wave cannot grow beyond the client's configured limiter. Checking between
    // waves leaves enough time to finish and flush answers before the function deadline.
    const width = Math.max(1, Math.min(32, plans[0]!.opts.client.limiter?.().cap ?? 32));
    for (let i = 0; i < missing.length; i += width) {
      const opts = plans[0]!.opts;
      if (opts.signal?.aborted || (opts.deadlineAt !== undefined &&
          Date.now() + (opts.deadlineReserveMs ?? 20_000) >= opts.deadlineAt)) {
        for (const item of missing.slice(i)) pending.add(item.call.key);
        break;
      }
      await Promise.all(missing.slice(i, i + width).map(async ({ sp, call }) => {
        const counters = stats.get(sp)!;
        let result: JevAskResult | undefined;
        for (let attempt = 0; !result; attempt++) {
          counters.calls++;
          if (attempt > 0) counters.retriedCalls++;
          try { result = await sp.opts.client.ask(call.request); }
          catch {
            if (attempt >= sp.retries) { counters.failedCalls++; failed.add(call.key); break; }
          }
        }
        if (result) {
          known.set(call.key, result);
          writer.add(call.key, result);
        }
      }));
    }
    await writer.flush();
    return await Promise.all(plans.map((sp) => execSite(sp, { known, writer, failed, pending, stats })));
  } finally {
    await writer.flush(); // also on a thrown error, so answers already in hand are kept
  }
}

export async function runPanel(opts: RunPanelOptions): Promise<PanelRun> {
  const [run] = await runPlans([await planSite(opts)]);
  return run!;
}

/**
 * Runs the panel for several candidate sites on the same personas, one table per site. All
 * sites share one cache read (a single round trip) and one write buffer, and all their calls
 * share the client's limiter.
 */
export async function runPanelForSites(
  opts: Omit<RunPanelOptions, "site"> & { sites: CandidateSite[] },
): Promise<{ tables: BehaviorTable[]; stats: PanelStats; progress: { completedPersonas: number; totalPersonas: number; inProgress: boolean } }> {
  const started = performance.now();
  const { sites, ...rest } = opts;
  const runs =
    sites.length === 0 ? [] : await runPlans(await Promise.all(sites.map((site) => planSite({ ...rest, site }))));
  const stats: PanelStats = {
    calls: sum(runs.map((r) => r.stats.calls)),
    cacheHits: sum(runs.map((r) => r.stats.cacheHits)),
    failedCalls: sum(runs.map((r) => r.stats.failedCalls)),
    retriedCalls: sum(runs.map((r) => r.stats.retriedCalls)),
    elapsedMs: performance.now() - started,
  };
  return { tables: runs.map((r) => r.table), stats, progress: {
    completedPersonas: sum(runs.map((r) => r.progress?.completedPersonas ?? 0)),
    totalPersonas: sum(runs.map((r) => r.progress?.totalPersonas ?? 0)),
    inProgress: runs.some((r) => r.progress?.inProgress),
  } };
}

// ---------------------------------------------------------------------------
// Aggregation across orders
// ---------------------------------------------------------------------------

export function aggregate(personaId: string, ctx: PanelContext, results: JevAskResult[], cacheKeys: string[]): PersonaBehavior {
  const whereIds = whereOptionIds(ctx);
  const perOrderWhere = results.map((r) => normalize(pick(r, "where").probabilities, whereIds));
  const where = normalize(meanMaps(perOrderWhere, whereIds), whereIds);
  let orderSpread = 0;
  for (const id of whereIds) {
    const vals = perOrderWhere.map((m) => m[id] ?? 0);
    orderSpread = Math.max(orderSpread, Math.max(...vals) - Math.min(...vals));
  }

  const howOften = normalize(
    meanMaps(
      results.map((r) => pick(r, "how_often").probabilities),
      HOW_OFTEN_LEVELS,
    ),
    HOW_OFTEN_LEVELS,
  );
  const visitsPerMonth = HOW_OFTEN_LEVELS.reduce((acc, lvl) => acc + (howOften[lvl] ?? 0) * VISITS_PER_MONTH[lvl], 0);

  const whenMap = normalize(
    meanMaps(
      results.map((r) => pick(r, "when").probabilities),
      TIME_BLOCKS,
    ),
    TIME_BLOCKS,
  );
  const timeBlocks = Object.fromEntries(TIME_BLOCKS.map((b) => [b, whenMap[b] ?? 0])) as Record<TimeBlock, number>;

  const stayNames = ASKED_LINE_LENGTHS.map(stayQuestionName);
  const stayByLineLength = ASKED_LINE_LENGTHS.map((lineLength, i) => ({
    lineLength,
    p: clamp01(mean(results.map((r) => pick(r, stayNames[i]!).probabilities.yes ?? 0))),
  }));

  const prices = pricePoints(ctx);
  const priceNames = prices.map(priceQuestionName);
  const priceAcceptance = prices.map((price, i) => ({
    price,
    p: clamp01(mean(results.map((r) => pick(r, priceNames[i]!).probabilities.yes ?? 0))),
  }));

  const conf = (names: string[]) => mean(results.flatMap((r) => names.map((n) => pick(r, n).confidence)));
  return {
    personaId,
    where,
    visitsPerMonth,
    timeBlocks,
    stayByLineLength,
    priceAcceptance,
    confidence: {
      where: conf(["where"]),
      howOften: conf(["how_often"]),
      when: conf(["when"]),
      stay: conf(stayNames),
      price: conf(priceNames),
    },
    orderSpread: clamp01(orderSpread),
    cacheKeys,
  };
}

function pick(r: JevAskResult, name: string) {
  const a = r.answers[name];
  if (!a) throw new Error(`Jev result missing answer "${name}"`);
  return a;
}

/** Restricts to `ids` (missing -> 0) and rescales to sum 1; uniform if all zero. */
function normalize(m: Record<string, number>, ids: readonly string[]): Record<string, number> {
  const total = ids.reduce((acc, id) => acc + Math.max(0, m[id] ?? 0), 0);
  return Object.fromEntries(ids.map((id) => [id, total > 0 ? Math.max(0, m[id] ?? 0) / total : 1 / ids.length]));
}

function meanMaps(maps: Record<string, number>[], ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, mean(maps.map((m) => m[id] ?? 0))]));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
