import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  EVALUATION_MODEL_VERSION,
  EvaluationRequestSchema,
  EvaluationResultSchema,
  type DemandSource,
  type EvaluationRequest,
} from "@/lib/contracts/evaluation";
import { STATION_OBSERVATION_VERSION } from "@/lib/contracts/station-experiment";
import {
  StationExperimentPlanRequestSchema,
  StationExperimentPostSchema,
  StationExperimentRunSchema,
  type StationExperimentConfigurationId,
  type StationExperimentRun,
} from "@/lib/contracts/station-experiment-run";
import type { Scenario } from "@/lib/contracts/scenario";
import {
  resolveDemandSource,
  seedList,
  type evaluateSitesResumable,
} from "@/lib/evaluation/evaluate";
import type { AssembledEvaluation } from "@/lib/evaluation/assemble";
import type { ComparisonStore, StoredComparison } from "@/lib/evaluation/store";
import type { ScenarioRepository } from "@/lib/scenario/repository";
import { createRootScenario } from "@/lib/scenario/model";
import { createScenarioRunner, scenarioExecutionKey } from "@/lib/scenario/run";
import {
  ScenarioRunError,
  type ScenarioExecution,
  type ScenarioExecutionStore,
} from "@/lib/scenario/run-store";
import { resolveStationCount } from "@/lib/sim/engine";
import { OriginSchema, type Origin } from "@/lib/sim/contracts";
import { stationExperimentsFromComparisons } from "./station-experiment-producer";

const sourceMarker = "station-experiment-source:";
const configMarker = "station-experiment-configuration:";
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const invalid = () => {
  throw new ScenarioRunError(
    "invalid",
    "Station experiment snapshot identity mismatch",
  );
};
const ids = (
  comparisonId: string,
  siteId: string,
  configurationId: StationExperimentConfigurationId,
) => {
  const digest = hash([
    comparisonId,
    siteId,
    configurationId,
    STATION_OBSERVATION_VERSION,
  ]);
  return {
    scenarioId: `station_scenario_${digest}`,
    runId: `station_run_${digest}`,
  };
};
type Plan = {
  source: StoredComparison;
  request: EvaluationRequest;
  dto: StationExperimentRun;
};
function plan(
  source: StoredComparison,
  projectId: string,
  input: z.output<typeof StationExperimentPlanRequestSchema>,
): Plan {
  const request = EvaluationRequestSchema.parse(source.evaluation.request);
  const seeds = seedList(request),
    actualSource = resolveDemandSource(request).source;
  const dto: StationExperimentRun = {
    status: "planned",
    source: {
      ...input,
      projectId,
      profileId: request.profileId,
      profileVersion: request.profileVersion,
      seedCount: seeds.length,
      seeds,
      synthetic: request.synthetic,
      demandSource: actualSource,
      sourceNotice:
        request.demandSource !== actualSource
          ? "Uses saved Huff fallback"
          : null,
      currentProfileVersion: null,
      outdated: null,
    },
    configurations: [],
    nextConfigurationId: null,
    confirmation: null,
    result: null,
    unavailable: null,
  };
  const unavailable = (code: string, reason: string): Plan => ({
    source,
    request,
    dto: { ...dto, status: "unavailable", unavailable: { code, reason } },
  });
  const result = EvaluationResultSchema.safeParse(source.evaluation.result);
  const site = request.sites.find((s) => s.siteId === input.siteId);
  if (!site) throw new ScenarioRunError("not_found", "Source site not found");
  if (
    request.projectId !== projectId ||
    source.id !== input.comparisonId ||
    source.comparison.id !== source.id ||
    source.comparison.projectId !== projectId ||
    source.comparison.profileId !== request.profileId ||
    source.comparison.modelVersion !== EVALUATION_MODEL_VERSION ||
    source.comparison.synthetic !== request.synthetic ||
    !result.success ||
    result.data.projectId !== projectId ||
    result.data.profileId !== request.profileId ||
    result.data.profileVersion !== request.profileVersion ||
    result.data.requestedDemandSource !== request.demandSource ||
    result.data.demandSource !== actualSource ||
    !same(result.data.seeds, seeds) ||
    !same(result.data.overrides, request.overrides) ||
    !same(
      result.data.sites.map((s) => s.siteId).sort(),
      request.sites.map((s) => s.siteId).sort(),
    )
  )
    return unavailable(
      "incompatible",
      "Saved comparison identity or inputs are incompatible.",
    );
  if (seeds.length < 2)
    return unavailable(
      "insufficient_seeds",
      "At least two saved seeds are required for paired ranges.",
    );
  const layout = source.evaluation.assembly?.scenario;
  if (
    layout?.layoutId &&
    (!layout.layout || layout.layout.siteId === input.siteId)
  )
    return unavailable(
      "immutable_layout",
      "The selected site has immutable layout capacity. Edit its layout before testing station changes.",
    );
  const config = site.config;
  const base = resolveStationCount(config),
    cap = Math.floor(config.stations.usableSf / config.stations.sfPerStation);
  const alternatives = ([1, 2] as const).filter(
    (n) =>
      config.stations.planned + n <= cap &&
      resolveStationCount({
        ...config,
        stations: { ...config.stations, planned: config.stations.planned + n },
      }) > base,
  );
  if (!alternatives.length)
    return unavailable(
      "no_effective_variants",
      "The modeled area capacity permits no effective additional station configuration.",
    );
  const variants = [
    { id: "baseline" as const, increment: 0 },
    ...alternatives.map((n) => ({
      id: n === 1 ? ("plus-one" as const) : ("plus-two" as const),
      increment: n,
    })),
  ];
  dto.configurations = variants.map(({ id, increment }) => ({
    id,
    plannedStations: config.stations.planned + increment,
    effectiveStations: base + increment,
    staffHeadcount: config.staff.headcount + increment,
    hours: structuredClone(config.hours),
    costUnits: seeds.length * 2,
    status: "planned",
    ...ids(source.id, input.siteId, id),
    comparisonId: null,
    cached: false,
  }));
  dto.nextConfigurationId = "baseline";
  return { source, request, dto };
}
async function loadPlan(
  comparisons: ComparisonStore,
  projectId: string,
  input: z.output<typeof StationExperimentPlanRequestSchema>,
) {
  const source = await comparisons.load(projectId, input.comparisonId);
  if (!source)
    throw new ScenarioRunError("not_found", "Source comparison not found");
  const p = plan(source, projectId, input);
  try {
    const current = await comparisons.currentProfileVersion(projectId);
    p.dto.source.currentProfileVersion = current;
    p.dto.source.outdated =
      current === null ? null : current !== p.request.profileVersion;
  } catch {
    /* Freshness is unknown when its read fails; never claim current. */
  }
  return p;
}
function expectedScenario(
  p: Plan,
  id: StationExperimentConfigurationId,
  createdAt: string,
): Scenario {
  const c = p.dto.configurations.find((c) => c.id === id);
  if (!c) return invalid();
  const evidenceIds = [
    p.source.id,
    `${sourceMarker}${p.source.id}`,
    `${configMarker}${id}`,
    `source-input-sha256:${hash(p.request)}`,
  ];
  const wrapper = (value: number, unit: string) => ({
    value,
    unit,
    origin: "default" as const,
    evidenceIds,
  });
  return createRootScenario({
    id: c.scenarioId,
    projectId: p.request.projectId,
    siteIds: [p.dto.source.siteId],
    profileVersion: p.request.profileVersion,
    label: `Station experiment ${id}`,
    author: "agent",
    rationale: `Test ${id} against immutable comparison ${p.source.id}; whole-day station and staff counts, saved inputs ${hash(p.request)}.`,
    createdAt,
    overrides: {
      plannedStations: wrapper(c.plannedStations, "stations"),
      ...(c.staffHeadcount > 0
        ? { staffHeadcount: wrapper(c.staffHeadcount, "people") }
        : {}),
      seedSet: {
        value: p.dto.source.seeds,
        unit: "seeds",
        origin: "default",
        evidenceIds,
      },
    },
  });
}
function validateScenario(
  scenario: Scenario,
  p: Plan,
  id: StationExperimentConfigurationId,
) {
  if (!same(scenario, expectedScenario(p, id, scenario.createdAt))) invalid();
}
function prepared(
  p: Plan,
  scenario: Scenario,
  id: StationExperimentConfigurationId,
): AssembledEvaluation {
  validateScenario(scenario, p, id);
  const c = p.dto.configurations.find((c) => c.id === id)!;
  const site = structuredClone(
    p.request.sites.find((s) => s.siteId === p.dto.source.siteId)!,
  );
  site.config.stations.planned = c.plannedStations;
  site.config.staff.headcount = c.staffHeadcount;
  const request = EvaluationRequestSchema.parse({
    ...structuredClone(p.request),
    sites: [site],
    seeds: p.dto.source.seeds.length,
    seedSet: p.dto.source.seeds,
    demandSource: p.dto.source.demandSource,
  });
  const metadata = structuredClone(
    p.source.evaluation.assembly ?? { assumptions: {}, findings: [] },
  );
  for (const [path, value] of Object.entries({
    "stations.planned": c.plannedStations,
    "staff.headcount": c.staffHeadcount,
  }))
    metadata.assumptions[`sites.${site.siteId}.config.${path}`] = {
      value,
      origin: "default",
      evidenceIds: [p.source.id],
    };
  return {
    ...metadata,
    request,
    scenario: {
      id: scenario.id,
      layoutId: null,
      layout: null,
      overrides: scenario.overrides,
    },
  };
}
/** Recognizes reserved source markers; station jobs can never fall through to fresh assembly. */
export async function prepareStationExperimentScenario(
  { comparisons }: { comparisons: ComparisonStore },
  scenario: Scenario,
  demandSource: DemandSource,
): Promise<AssembledEvaluation | null> {
  const evidence = scenario.overrides.seedSet?.evidenceIds ?? [];
  const marker = evidence.filter((v) => v.startsWith(sourceMarker));
  const configs = evidence.filter((v) => v.startsWith(configMarker));
  if (!marker.length && !configs.length) return null;
  if (
    marker.length !== 1 ||
    configs.length !== 1 ||
    scenario.siteIds.length !== 1
  )
    return invalid();
  const input = StationExperimentPostSchema.parse({
    comparisonId: marker[0].slice(sourceMarker.length),
    siteId: scenario.siteIds[0],
    configurationId: configs[0].slice(configMarker.length),
  });
  const p = await loadPlan(comparisons, scenario.projectId, input);
  if (
    p.dto.status === "unavailable" ||
    p.dto.source.demandSource !== demandSource
  )
    return invalid();
  return prepared(p, scenario, input.configurationId);
}
/** Recorded input badges, plus default for the proposed station/staff assumptions. */
function recordedInputOrigins(p: Plan): Origin[] {
  const origins = new Set<Origin>(["default"]);
  const sitePrefix = `sites.${p.dto.source.siteId}.`;
  for (const [path, assumption] of Object.entries(
    p.source.evaluation.assembly?.assumptions ?? {},
  )) {
    if (
      !path.startsWith(sitePrefix) &&
      !/^(profile|category|personas|competitors|scenario|demand|project)\./.test(
        path,
      )
    )
      continue;
    const origin = OriginSchema.safeParse(assumption.origin);
    if (origin.success) origins.add(origin.data);
  }
  return [...origins];
}
export function createStationExperimentService({
  comparisons,
  scenarios,
  executions,
  budgetUnits,
  evaluate,
  now = () => new Date(),
  newToken = randomUUID,
}: {
  comparisons: ComparisonStore;
  scenarios: Pick<ScenarioRepository, "get" | "insert">;
  executions: ScenarioExecutionStore;
  budgetUnits?: number;
  evaluate?: typeof evaluateSitesResumable;
  now?: () => Date;
  newToken?: () => string;
}) {
  async function read(p: Plan): Promise<StationExperimentRun> {
    if (p.dto.status === "unavailable")
      return StationExperimentRunSchema.parse(p.dto);
    const dto = structuredClone(p.dto);
    const records: StoredComparison[] = [];
    for (const c of dto.configurations) {
      const scenario = await scenarios.get(p.request.projectId, c.scenarioId);
      if (scenario) validateScenario(scenario, p, c.id);
      const job = await executions.get(p.request.projectId, c.runId);
      if (!job) continue;
      if (!scenario) invalid();
      validateJob(job, p, scenario!, c.id);
      c.status = job.status;
      c.costUnits = job.costUnits;
      c.cached = job.cached;
      c.comparisonId = job.comparisonId;
      if (job.status === "succeeded") {
        if (!job.comparisonId) invalid();
        const record = await comparisons.load(
          p.request.projectId,
          job.comparisonId!,
        );
        if (
          !record ||
          !same(record.evaluation.request, prepared(p, scenario!, c.id).request)
        )
          invalid();
        records.push(record!);
      }
    }
    dto.nextConfigurationId =
      dto.configurations.find((c) => c.status !== "succeeded")?.id ?? null;
    if (dto.configurations.some((c) => c.status === "failed")) {
      dto.status = "unavailable";
      dto.unavailable = {
        code: "execution_failed",
        reason:
          "A configuration failed validation. Its execution cannot be continued.",
      };
    } else if (!dto.nextConfigurationId) {
      dto.result = stationExperimentsFromComparisons({
        baseline: records[0],
        alternatives: records.slice(1).map((comparison, i) => ({
          id: dto.configurations[i + 1].id,
          comparison,
        })),
        siteId: dto.source.siteId,
        dayType: dto.source.dayType,
        origins: recordedInputOrigins(p),
      });
      dto.status = dto.result.status === "available" ? "ready" : "unavailable";
      if (dto.result.status === "unavailable")
        dto.unavailable = { code: dto.result.code, reason: dto.result.reason };
    } else
      dto.status = dto.configurations.some((c) => c.status !== "planned")
        ? "running"
        : "planned";
    return StationExperimentRunSchema.parse(dto);
  }
  function validateJob(
    job: ScenarioExecution,
    p: Plan,
    scenario: Scenario,
    id: StationExperimentConfigurationId,
  ) {
    const expected = ids(p.source.id, p.dto.source.siteId, id);
    if (
      job.id !== expected.runId ||
      job.projectId !== p.request.projectId ||
      job.scenarioId !== scenario.id ||
      job.idempotencyKey !== expected.runId ||
      job.effectiveKey !==
        scenarioExecutionKey(scenario, p.dto.source.demandSource) ||
      (job.request && !same(job.request, prepared(p, scenario, id).request))
    )
      invalid();
  }
  return {
    async get(projectId: string, raw: unknown) {
      return read(
        await loadPlan(
          comparisons,
          projectId,
          StationExperimentPlanRequestSchema.parse(raw),
        ),
      );
    },
    async post(projectId: string, raw: unknown) {
      const input = StationExperimentPostSchema.parse(raw),
        p = await loadPlan(comparisons, projectId, input);
      if (p.dto.status === "unavailable") return read(p);
      const c = p.dto.configurations.find(
        (c) => c.id === input.configurationId,
      );
      if (!c) return invalid();
      const expected = expectedScenario(p, c.id, now().toISOString());
      let scenario = await scenarios.get(projectId, c.scenarioId);
      if (!scenario) {
        try {
          scenario = await scenarios.insert(expected);
        } catch (error) {
          scenario = await scenarios.get(projectId, c.scenarioId);
          if (!scenario) throw error;
        }
      }
      validateScenario(scenario, p, c.id);
      const prior = await executions.get(projectId, c.runId);
      if (prior) validateJob(prior, p, scenario, c.id);
      let firstId = true;
      const runner = createScenarioRunner({
        scenarios,
        executions,
        comparisons,
        budgetUnits,
        evaluate,
        now,
        newId: () => {
          if (firstId) {
            firstId = false;
            return c.runId;
          }
          return newToken();
        },
        prepare: async (s, source) => {
          if (source !== p.dto.source.demandSource) return invalid();
          return prepared(p, s, c.id);
        },
      });
      // Advance may need unique lease IDs even when a deterministic reservation already exists.
      const outcome = await runner.start(projectId, c.scenarioId, {
        confirm: input.confirm,
        idempotencyKey: c.runId,
        demandSource: p.dto.source.demandSource,
      });
      const dto = await read(p);
      if (outcome.status === "needs_confirmation") {
        dto.status = "needs_confirmation";
        dto.confirmation = {
          configurationId: c.id,
          costUnits: outcome.costUnits,
          remainingUnits: outcome.remainingUnits,
        };
      }
      return StationExperimentRunSchema.parse(dto);
    },
  };
}
export type StationExperimentService = ReturnType<
  typeof createStationExperimentService
>;

/** Shared by generic scenario resume and station routes: failed snapshot reads never fall back. */
export function withStationExperimentSnapshots({
  comparisons,
  prepare,
}: {
  comparisons: ComparisonStore;
  prepare: (
    scenario: Scenario,
    source: DemandSource,
  ) => Promise<AssembledEvaluation>;
}) {
  return async (scenario: Scenario, source: DemandSource) =>
    (await prepareStationExperimentScenario(
      { comparisons },
      scenario,
      source,
    )) ?? prepare(scenario, source);
}
