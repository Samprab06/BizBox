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
  /**
   * Deadline (HAC-155), epoch ms on `now`'s clock. Near it the panel stops issuing new Jev
   * calls, keeps every answer already in hand (they are cached by key) and returns a run whose
   * `progress.inProgress` is true instead of failing; the next run with the same inputs resumes
   * from the cache. Calls still in flight at `deadlineAt - deadlineReserveMs` are abandoned for
   * this run (their answers are written to the cache if they arrive in time).
   */
  deadlineAt?: number;
  /** Time kept free before `deadlineAt` for the cache flush and the caller's reply. Default 2 s. */
  deadlineReserveMs?: number;
  /**
   * Expected duration of one Jev call, used before any call has been timed: a call is only
   * issued if it is expected to finish before the reserve. Afterwards the slowest observed
   * call is used. Default 5 s.
   */
  estimatedCallMs?: number;
  /** Aborting stops new Jev calls the same way the deadline does. */
  signal?: AbortSignal;
  /** Clock for the deadline. Default `Date.now`. */
  now?: () => number;
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

/** How far a deadline-limited panel got. Failed personas count as completed (nothing to resume). */
export interface PanelProgress {
  completedPersonas: number;
  totalPersonas: number;
  /** True when some persona still has unasked calls; the table is partial and must not be used. */
  inProgress: boolean;
}

export const DEFAULT_DEADLINE_RESERVE_MS = 2_000;
export const DEFAULT_ESTIMATED_CALL_MS = 5_000;

export interface PanelRun {
  table: BehaviorTable;
  stats: PanelStats;
  progress: PanelProgress;
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
  /** Everything the cache held for this run's keys, plus the answers this run received. */
  known: Map<string, JevAskResult>;
  /** Keys answered by Jev during this run (not cache hits). */
  fresh: Set<string>;
  /** Keys not asked (or abandoned) because of the deadline; the next run asks them. */
  pending: Set<string>;
  stats: Map<SitePlan, PanelStats>;
  started: number;
}

function execSite(sp: SitePlan, shared: SharedRun): PanelRun {
  const { opts, ctx, orders } = sp;
  const modelVersion = opts.client.modelVersion;
  const stats = shared.stats.get(sp)!;
  const answeredVersions = new Set<string>();

  const outcomes = sp.plan.map(({ persona, calls }) => {
    const results: JevAskResult[] = [];
    let pending = false;
    let failed = false;
    for (const call of calls) {
      const hit = shared.known.get(call.key);
      if (hit) {
        if (!shared.fresh.has(call.key)) stats.cacheHits++;
        results.push(hit);
      } else if (shared.pending.has(call.key)) pending = true;
      else failed = true;
    }
    // A persona with unasked calls is resumable, not failed: the next run asks the rest.
    if (pending) return { personaId: persona.id, behavior: undefined, pending: true };
    opts.onPersona?.(persona.id, !failed);
    if (failed) return { personaId: persona.id, behavior: undefined, pending: false };
    for (const r of results) answeredVersions.add(r.modelVersion);
    const views = calls.flatMap((c, i) => (c.bundled ? expandBundled(results[i]!, orders) : [results[i]!]));
    return {
      personaId: persona.id,
      pending: false,
      behavior: aggregate(
        persona.id,
        ctx,
        views,
        calls.map((c) => c.key),
      ),
    };
  });

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
  stats.elapsedMs = performance.now() - shared.started;
  return {
    table: BehaviorTableSchema.parse(table),
    stats,
    progress: {
      completedPersonas: outcomes.filter((o) => !o.pending).length,
      totalPersonas: outcomes.length,
      inProgress: outcomes.some((o) => o.pending),
    },
  };
}

/**
 * One batched cache read for every key of `plans`, then asks the missing keys through a pool
 * of workers sharing one write buffer. Workers pull the next call only while it is expected to
 * finish before the deadline (HAC-155); the pool is as wide as the client's limiter, so the
 * limiter (not this queue) still decides how many are really in flight.
 */
async function runPlans(plans: SitePlan[]): Promise<PanelRun[]> {
  const started = performance.now();
  const opts = plans[0]!.opts;
  const cache = opts.cache;
  const known = await readCache(cache, plans.flatMap((sp) => sp.plan.flatMap((p) => p.calls.map((c) => c.key))));
  const writer = new CacheWriter(cache);
  const fresh = new Set<string>();
  const failed = new Set<string>();
  const pending = new Set<string>();
  const stats = new Map(plans.map((sp) => [sp, { calls: 0, cacheHits: 0, failedCalls: 0, retriedCalls: 0, elapsedMs: 0 }]));
  const now = opts.now ?? Date.now;
  const reserveMs = Math.max(0, opts.deadlineReserveMs ?? DEFAULT_DEADLINE_RESERVE_MS);
  let callMs = Math.max(0, opts.estimatedCallMs ?? DEFAULT_ESTIMATED_CALL_MS);
  let timed = false;
  let closed = false;
  const outOfTime = () =>
    closed ||
    Boolean(opts.signal?.aborted) ||
    (opts.deadlineAt !== undefined && now() + callMs + reserveMs > opts.deadlineAt);

  // Every cache miss, in plan order (deterministic), so a cut-off run resumes where it stopped.
  const queue = plans.flatMap((sp) =>
    sp.plan.flatMap((p) => p.calls.filter((call) => !known.has(call.key)).map((call) => ({ sp, call }))),
  );

  async function ask({ sp, call }: { sp: SitePlan; call: KeyedCall }) {
    const counters = stats.get(sp)!;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && outOfTime()) {
        pending.add(call.key); // retry next run instead of reporting a failure
        return;
      }
      counters.calls++;
      if (attempt > 0) counters.retriedCalls++;
      const t0 = now();
      try {
        const result = await sp.opts.client.ask(call.request);
        const took = now() - t0;
        callMs = timed ? Math.max(callMs, took) : took;
        timed = true;
        writer.add(call.key, result); // buffered, flushed in batches as answers arrive
        if (!closed) {
          known.set(call.key, result);
          fresh.add(call.key);
        }
        return;
      } catch {
        if (attempt >= sp.retries) {
          counters.failedCalls++;
          if (!closed) failed.add(call.key);
          return;
        }
      }
    }
  }

  let next = 0;
  const width = Math.max(1, Math.min(queue.length, opts.client.limiter?.().cap ?? 32));
  const worker = async () => {
    while (next < queue.length && !outOfTime()) await ask(queue[next++]!);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pool = Promise.all(Array.from({ length: queue.length ? width : 0 }, worker));
    if (opts.deadlineAt === undefined && !opts.signal) await pool;
    else {
      // Hard stop: a call slower than expected must not hold the run past the reserve.
      const cutoff = new Promise<void>((resolve) => {
        if (opts.deadlineAt !== undefined)
          timer = setTimeout(resolve, Math.max(0, opts.deadlineAt - reserveMs - now()));
        opts.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      await Promise.race([pool, cutoff]);
    }
    closed = true;
    // Never-asked and abandoned calls resume next run; calls that exhausted retries stay failed.
    for (const { call } of queue) if (!known.has(call.key) && !failed.has(call.key)) pending.add(call.key);
    return plans.map((sp) => execSite(sp, { known, fresh, pending, stats, started }));
  } finally {
    if (timer) clearTimeout(timer);
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
 * share the client's limiter. `competitorsForSite` (HAC-156) gives each site its own competitor
 * set instead of the shared `competitors`, so a site's prompts and cache keys do not depend on
 * which other candidates are in the run.
 */
export async function runPanelForSites(
  opts: Omit<RunPanelOptions, "site"> & {
    sites: CandidateSite[];
    competitorsForSite?: (site: CandidateSite) => Competitor[];
  },
): Promise<{ tables: BehaviorTable[]; stats: PanelStats; progress: PanelProgress }> {
  const started = performance.now();
  const { sites, competitorsForSite, ...rest } = opts;
  const runs =
    sites.length === 0
      ? []
      : await runPlans(
          await Promise.all(
            sites.map((site) =>
              planSite({ ...rest, site, competitors: competitorsForSite?.(site) ?? rest.competitors }),
            ),
          ),
        );
  const stats: PanelStats = {
    calls: sum(runs.map((r) => r.stats.calls)),
    cacheHits: sum(runs.map((r) => r.stats.cacheHits)),
    failedCalls: sum(runs.map((r) => r.stats.failedCalls)),
    retriedCalls: sum(runs.map((r) => r.stats.retriedCalls)),
    elapsedMs: performance.now() - started,
  };
  return { tables: runs.map((r) => r.table), stats, progress: {
    completedPersonas: sum(runs.map((r) => r.progress.completedPersonas)),
    totalPersonas: sum(runs.map((r) => r.progress.totalPersonas)),
    inProgress: runs.some((r) => r.progress.inProgress),
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
