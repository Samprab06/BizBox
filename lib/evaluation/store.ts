import {
  SiteComparisonSchema,
  SiteRunSchema,
  type SiteComparison,
  type SiteRun,
} from "@/lib/contracts";
import type {
  EvaluationRequest,
  EvaluationResult,
  SensitivityResult,
} from "@/lib/contracts/evaluation";
import type { DayType } from "@/lib/demand/contracts";
import type { DayResult, SiteConfig } from "@/lib/sim/contracts";
import { canonicalEvents, isOutdated, type EvaluationRun } from "./evaluate";
import type { RobustnessSummary } from "./robustness";
import type { AssemblyMetadata } from "./assemble";

/** What a stored comparison keeps so it reruns exactly from cache (comparisons.evaluation). */
export interface StoredEvaluation {
  request: EvaluationRequest;
  result: EvaluationResult;
  sensitivity: SensitivityResult[];
  /** Input origins and exclusions from deterministic assembly, when used. */
  assembly?: AssemblyMetadata;
  /** HAC-62: headline robustness summary, computed when the comparison was created. */
  robustness?: RobustnessSummary;
}

export interface StoredComparison {
  id: string;
  evaluation: StoredEvaluation;
  comparison: SiteComparison;
  runs: SiteRun[];
}

export interface ComparisonStore {
  save(record: StoredComparison): Promise<void>;
  load(
    projectId: string,
    comparisonId: string,
  ): Promise<StoredComparison | null>;
  /** Latest profile version of the project, or null when it has no profile. */
  currentProfileVersion(projectId: string): Promise<number | null>;
  saveSensitivity(
    projectId: string,
    comparisonId: string,
    record: StoredComparison,
  ): Promise<void>;
}

const cents = (usd: number) => Math.round(usd * 100);

/** Canonical SiteRun for one representative day: day revenue minus COGS and that day's labor. */
export function toSiteRun(args: {
  id: string;
  request: EvaluationRequest;
  config: SiteConfig;
  day: DayResult;
  dayType: DayType;
  modelVersion: string;
  demandSource: EvaluationResult["demandSource"];
}): SiteRun {
  const { id, request, config, day, dayType } = args;
  const events = canonicalEvents(day.events);
  const arrivingPersonas = new Set(events.flatMap((event) =>
    event.arrival ? [event.arrival.personaId] : [],
  ));
  const table = args.demandSource === "jev"
    ? request.sites.find((site) => site.siteId === day.siteId)?.behaviorTable
    : undefined;
  const answers = new Map(table?.personas.filter((persona) =>
    !table.failedPersonaIds.includes(persona.personaId),
  ).map((persona) => [persona.personaId, persona]));
  const replayPersonas = request.personaSet.personas
    .filter((persona) => arrivingPersonas.has(persona.id))
    .map(({ id, segment }) => {
      const answer = answers.get(id);
      return { id, segment, jev: answer && {
        where: answer.where,
        visitsPerMonth: answer.visitsPerMonth,
      } };
    });
  const m = day.metrics;
  const hours = config.hours[dayType];
  const laborUsd =
    (config.staff.headcount *
      (hours.closeMin - hours.openMin) *
      config.staff.wageUsdPerHour) /
    60;
  const revenueCents = cents(m.revenueUsd);
  const includedCostCents =
    cents(m.revenueUsd * config.costs.cogsPctOfRevenue) + cents(laborUsd);
  return SiteRunSchema.parse({
    id,
    projectId: request.projectId,
    synthetic: request.synthetic,
    siteId: day.siteId,
    profileId: request.profileId,
    arrivalScheduleId: `${id}:schedule`,
    modelVersion: args.modelVersion,
    seed: day.seed,
    dayType,
    outputKind: "simulated",
    metrics: {
      completedCustomers: m.served,
      unservedCustomers: Math.max(0, m.arrivals - m.served),
      revenueCents,
      includedCostCents,
      operatingContributionCents: revenueCents - includedCostCents,
      averageWaitMinutes: m.meanWaitMin ?? 0,
    },
    events,
    replayPersonas,
  });
}

/** Builds the stored record: canonical comparison, canonical runs, and the full evaluation. */
export function buildStoredComparison(
  id: string,
  request: EvaluationRequest,
  run: EvaluationRun,
): StoredComparison {
  const { result } = run;
  const runId = (localId: string) => `${id}:${localId}`;
  const runs: SiteRun[] = [];
  const configs = new Map(request.sites.map((s) => [s.siteId, s.config]));
  for (const site of result.sites) {
    for (const dayType of ["weekday", "weekend"] as const) {
      const rep = site.representative[dayType];
      runs.push(
        toSiteRun({
          id: runId(rep.runId),
          request,
          config: configs.get(site.siteId)!,
          day: run.representativeDays[site.siteId]![dayType],
          dayType,
          modelVersion: result.modelVersion,
          demandSource: result.demandSource,
        }),
      );
    }
  }
  // Representative run IDs inside the evaluation point at the stored site_runs rows.
  const stored: EvaluationResult = {
    ...result,
    sites: result.sites.map((s) => ({
      ...s,
      representative: {
        weekday: {
          ...s.representative.weekday,
          runId: runId(s.representative.weekday.runId),
          eventIds: s.representative.weekday.eventIds.map(runId),
        },
        weekend: {
          ...s.representative.weekend,
          runId: runId(s.representative.weekend.runId),
          eventIds: s.representative.weekend.eventIds.map(runId),
        },
      },
    })),
  };
  const evaluation: StoredEvaluation = {
    request,
    result: stored,
    sensitivity: [],
  };
  return {
    id,
    evaluation,
    comparison: toSiteComparison(id, evaluation, runs),
    runs,
  };
}

export function toSiteComparison(
  id: string,
  evaluation: StoredEvaluation,
  runs: readonly SiteRun[],
): SiteComparison {
  const { request, result } = evaluation;
  return SiteComparisonSchema.parse({
    id,
    projectId: request.projectId,
    synthetic: request.synthetic,
    profileId: request.profileId,
    modelVersion: result.modelVersion,
    runIds: runs.map((r) => r.id),
    results: result.sites.map((s) => ({
      siteId: s.siteId,
      rank: s.rank,
      runIds: [s.representative.weekday.runId, s.representative.weekend.runId],
      operatingContributionCents: {
        low: cents(s.monthlyContributionUsd.low),
        median: cents(s.monthlyContributionUsd.median),
        high: cents(s.monthlyContributionUsd.high),
      },
    })),
    sensitivity: evaluation.sensitivity.map((s) => ({
      parameter: s.assumption,
      values: s.points.map((p) => ({
        value: p.value,
        unit: s.unit === "usd" ? "usd" : "multiplier",
        origin: "default",
        evidenceIds: [id],
      })),
      conclusion: s.conclusion,
    })),
    outputKind: "scenario_comparison",
  });
}

/** Adds a sensitivity result to a stored comparison (replacing an earlier one for the same assumption). */
export function withSensitivity(
  record: StoredComparison,
  sensitivity: SensitivityResult,
): StoredComparison {
  const evaluation: StoredEvaluation = {
    ...record.evaluation,
    sensitivity: [
      ...record.evaluation.sensitivity.filter(
        (s) => s.assumption !== sensitivity.assumption,
      ),
      sensitivity,
    ],
  };
  return {
    ...record,
    evaluation,
    comparison: toSiteComparison(record.id, evaluation, record.runs),
  };
}

export async function outdatedFlag(
  store: ComparisonStore,
  record: StoredComparison,
): Promise<boolean> {
  const current = await store.currentProfileVersion(
    record.evaluation.request.projectId,
  );
  return current !== null && isOutdated(record.evaluation.result, current);
}

/** In-memory store for tests and fixture demos. */
export function createMemoryComparisonStore(
  profileVersions: Record<string, number> = {},
): ComparisonStore & {
  profileVersions: Record<string, number>;
  records: Map<string, StoredComparison>;
} {
  const records = new Map<string, StoredComparison>();
  const key = (projectId: string, id: string) => `${projectId}/${id}`;
  return {
    profileVersions,
    records,
    async save(record) {
      records.set(
        key(record.evaluation.request.projectId, record.id),
        structuredClone(record),
      );
    },
    async load(projectId, id) {
      const r = records.get(key(projectId, id));
      return r ? structuredClone(r) : null;
    },
    async currentProfileVersion(projectId) {
      return profileVersions[projectId] ?? null;
    },
    async saveSensitivity(projectId, id, record) {
      records.set(key(projectId, id), structuredClone(record));
    },
  };
}
