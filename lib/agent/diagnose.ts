import { isDeepStrictEqual } from "node:util";
import {
  CopilotReadSchemas,
  DiagnosisExperimentSchema,
  DiagnosisFindingSchema,
  ExperimentDiffCardSchema,
  type Bottleneck,
  type CopilotReadResult,
  type DiagnosisExperiment,
  type DiagnosisFinding,
  type DiagnosisHourBlock,
  type ExperimentDiffCard,
} from "@/lib/contracts/copilot-read-tools";
import { CopilotMutationSchemas } from "@/lib/contracts/copilot-tools";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
  type EvaluationRequest,
  type EvaluationResult,
  type HourlyStat,
  type SiteEvaluation,
} from "@/lib/contracts/evaluation";
import type { Scenario } from "@/lib/contracts/scenario";
import { DEFAULT_ALPHA, DEFAULT_BETA } from "@/lib/demand/defaults";
import { huffShare } from "@/lib/demand/huff";
import type { StoredComparison } from "@/lib/evaluation/store";
import { diffScenarios } from "@/lib/scenario/model";

/**
 * HAC-89: post-run bottleneck diagnosis. Pure and deterministic: it reads one verified,
 * saved comparison (the HAC-22 evaluation and its representative runs) and never runs a
 * simulation, calls a model or touches a provider. Every finding cites the saved run IDs
 * and hour blocks it came from, and carries typed references instead of numeric prose.
 *
 * Experiments are proposals for existing copilot tools. A mutation experiment becomes a
 * pending proposal through the normal tool path; only the human's Run starts a run.
 */
export const DIAGNOSIS_THRESHOLDS = {
  /** Busy share of available station-minutes at or above which an hour is saturated. */
  capacityUtilization: 0.85,
  /** Walk-aways per arrival at or above which a saturated hour loses customers. */
  capacityWalkawayRate: 0.1,
  /** Minimum walk-aways in an hour before calling it capacity-limited. */
  capacityMinWalkaways: 2,
  /** Busy share at or below which capacity sits idle. */
  demandUtilization: 0.4,
} as const;

export const MAX_EXPERIMENTS = 3;
const MAX_FINDINGS = 40;

type Day = "weekday" | "weekend";
const DAYS: readonly Day[] = ["weekday", "weekend"];
type Diagnosed = Extract<CopilotReadResult, { status: "diagnosed" }>;
export type Diagnosis = Omit<Diagnosed, "status" | "experimentCard">;

export class DiagnosisScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosisScopeError";
  }
}

/** Scenario a saved comparison belongs to: the scoped execution receipt wins. */
export function comparisonScenarioId(
  record: StoredComparison & { copilotBinding?: { scenarioId: string } },
): string | undefined {
  return (
    record.copilotBinding?.scenarioId ??
    record.evaluation.assembly?.scenario?.id
  );
}

function verifyScope(scenario: Scenario, record: StoredComparison) {
  const request = EvaluationRequestSchema.parse(record.evaluation.request);
  const result = EvaluationResultSchema.parse(record.evaluation.result);
  const snapshot = record.evaluation.assembly?.scenario;
  const ids = request.sites.map((site) => site.siteId);
  if (
    comparisonScenarioId(record) !== scenario.id ||
    !snapshot ||
    snapshot.layoutId !== scenario.layoutId ||
    !isDeepStrictEqual(snapshot.overrides, scenario.overrides) ||
    request.projectId !== scenario.projectId ||
    result.projectId !== scenario.projectId ||
    request.profileVersion !== scenario.profileVersion ||
    result.profileVersion !== scenario.profileVersion ||
    request.profileId !== result.profileId ||
    ids.length !== scenario.siteIds.length ||
    !scenario.siteIds.every((id) => ids.includes(id))
  )
    throw new DiagnosisScopeError(
      "The saved comparison does not belong to this scenario version",
    );
  return { request, result };
}

/** Hours [h, h+1) that intersect the opening window. */
function openHours(hours: { openMin: number; closeMin: number }): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++)
    if (h * 60 < hours.closeMin && (h + 1) * 60 > hours.openMin) out.push(h);
  return out;
}

function classifyHour(stat: HourlyStat): "capacity" | "demand" | null {
  const t = DIAGNOSIS_THRESHOLDS;
  if (
    stat.utilization >= t.capacityUtilization &&
    stat.abandoned >= t.capacityMinWalkaways &&
    stat.abandoned / Math.max(1, stat.arrivals) >= t.capacityWalkawayRate
  )
    return "capacity";
  if (stat.utilization <= t.demandUtilization && stat.abandoned === 0)
    return "demand";
  return null;
}

/** Contiguous runs of equally classified open hours. */
function hourBlocks(
  hourly: readonly HourlyStat[],
  open: readonly number[],
): { kind: "capacity" | "demand"; stats: HourlyStat[] }[] {
  const blocks: { kind: "capacity" | "demand"; stats: HourlyStat[] }[] = [];
  let previousHour = -2;
  for (const h of open) {
    const stats = hourly.filter((row) => row.hour === h);
    if (stats.length !== 1) {
      previousHour = -2;
      continue;
    }
    const kind = classifyHour(stats[0]);
    const last = blocks.at(-1);
    if (kind && last && last.kind === kind && previousHour === h - 1)
      last.stats.push(stats[0]);
    else if (kind) blocks.push({ kind, stats: [stats[0]] });
    previousHour = kind ? h : -2;
  }
  return blocks;
}

export type SegmentShare = {
  segment: string;
  /** Sum of persona weights in the segment. */
  weight: number;
  /** Weighted modeled share per store ID (the site and each competitor). */
  shares: Record<string, number>;
};

/**
 * Weighted per-segment choice shares for one site, from the same inputs the demand model
 * used: cached Jev `where` answers, or Huff over the request's competitors.
 */
export function segmentShares(
  request: EvaluationRequest,
  siteId: string,
  source: "jev" | "huff",
): SegmentShare[] {
  const site = request.sites.find((row) => row.siteId === siteId);
  if (!site) return [];
  const bySegment = new Map<string, SegmentShare>();
  const add = (
    segment: string,
    weight: number,
    shares: Record<string, number>,
  ) => {
    const row = bySegment.get(segment) ?? { segment, weight: 0, shares: {} };
    row.weight += weight;
    for (const [store, share] of Object.entries(shares))
      row.shares[store] = (row.shares[store] ?? 0) + weight * share;
    bySegment.set(segment, row);
  };
  if (source === "jev") {
    const table = site.behaviorTable;
    if (!table) return [];
    const failed = new Set(table.failedPersonaIds);
    const answers = new Map(table.personas.map((p) => [p.personaId, p]));
    for (const persona of request.personaSet.personas) {
      const answer = answers.get(persona.id);
      if (!answer || failed.has(persona.id) || persona.weight <= 0) continue;
      const shares: Record<string, number> = {};
      for (const [store, share] of Object.entries(answer.where))
        if (store !== "none") shares[store] = share;
      shares[siteId] ??= 0;
      add(persona.segment, persona.weight, shares);
    }
  } else {
    const options = {
      alpha: DEFAULT_ALPHA,
      beta: DEFAULT_BETA,
      city: request.city,
    };
    const competitors = request.competitors.filter((c) => c.id !== siteId);
    for (const persona of request.personaSet.personas) {
      if (persona.weight <= 0) continue;
      const shares: Record<string, number> = {
        [siteId]: huffShare(persona, site.storefront, competitors, options),
      };
      for (const competitor of competitors)
        shares[competitor.id] = huffShare(
          persona,
          competitor,
          [site.storefront, ...competitors.filter((c) => c !== competitor)],
          options,
        );
      add(persona.segment, persona.weight, shares);
    }
  }
  return [...bySegment.values()]
    .filter((row) => row.weight > 0)
    .map((row) => ({
      ...row,
      shares: Object.fromEntries(
        Object.entries(row.shares).map(([store, sum]) => [
          store,
          sum / row.weight,
        ]),
      ),
    }))
    .sort((a, b) => a.segment.localeCompare(b.segment));
}

function fullDayBlocks(
  request: EvaluationRequest,
  site: SiteEvaluation,
): DiagnosisHourBlock[] {
  const config = request.sites.find((s) => s.siteId === site.siteId)!.config;
  return DAYS.flatMap((day) => {
    const open = openHours(config.hours[day]);
    if (!open.length) return [];
    return [
      {
        day,
        runId: site.representative[day].runId,
        startHour: open[0],
        endHour: open.at(-1)! + 1,
      },
    ];
  });
}

function siteFindings(
  comparisonId: string,
  request: EvaluationRequest,
  site: SiteEvaluation,
): DiagnosisFinding[] {
  const config = request.sites.find((s) => s.siteId === site.siteId)!.config;
  const findings: DiagnosisFinding[] = [];
  const finding = (
    bottleneck: Bottleneck,
    key: string,
    rest: Omit<
      DiagnosisFinding,
      "id" | "siteId" | "bottleneck" | "comparisonId"
    >,
  ) =>
    findings.push(
      DiagnosisFindingSchema.parse({
        id: `${comparisonId}:${site.siteId}:${bottleneck}:${key}`,
        siteId: site.siteId,
        bottleneck,
        comparisonId,
        ...rest,
      }),
    );
  for (const day of DAYS) {
    const rep = site.representative[day];
    for (const block of hourBlocks(rep.hourly, openHours(config.hours[day]))) {
      const startHour = block.stats[0].hour;
      const endHour = block.stats.at(-1)!.hour + 1;
      const metrics =
        block.kind === "capacity"
          ? (["utilization", "abandoned", "arrivals", "meanWaitMin"] as const)
          : (["utilization", "arrivals", "served"] as const);
      const references: DiagnosisFinding["references"] = block.stats.flatMap(
        (stat) =>
          metrics
            .filter(
              (metric) => metric !== "meanWaitMin" || stat.meanWaitMin !== null,
            )
            .map((metric) => ({
              kind: "hour_metric" as const,
              runId: rep.runId,
              hour: stat.hour,
              metric,
            })),
      );
      if (block.kind === "capacity" && day === "weekday")
        references.push(
          ...(["weekdayAbandonmentRate", "weekdayUtilization"] as const).map(
            (metric) => ({
              kind: "comparison_metric" as const,
              comparisonId,
              siteId: site.siteId,
              metric,
              statistic: "median" as const,
            }),
          ),
        );
      finding(
        block.kind === "capacity" ? "capacity_limited" : "demand_limited",
        `${day}:${startHour}`,
        {
          runIds: [rep.runId],
          hourBlocks: [{ day, runId: rep.runId, startHour, endHour }],
          summary:
            block.kind === "capacity"
              ? "Capacity-limited: every station stays busy and walk-aways grow as the line lengthens."
              : "Demand-limited: stations sit idle and nobody walks away.",
          references,
        },
      );
    }
  }
  if (site.monthlyContributionUsd.median < 0)
    finding("rent_limited", "month", {
      runIds: DAYS.map((day) => site.representative[day].runId),
      hourBlocks: fullDayBlocks(request, site),
      summary:
        "Rent-limited: monthly operating contribution is negative at the median after rent and operating costs.",
      references: (
        [
          "monthlyContributionUsd",
          "monthlyRevenueUsd",
          "monthlyContributionAfterBuildoutUsd",
        ] as const
      ).map((metric) => ({
        kind: "comparison_metric" as const,
        comparisonId,
        siteId: site.siteId,
        metric,
        statistic: "median" as const,
      })),
    });
  let leak: { segment: string; competitorId: string; gap: number } | undefined;
  for (const row of segmentShares(request, site.siteId, site.demandSource)) {
    const own = row.shares[site.siteId] ?? 0;
    for (const [store, share] of Object.entries(row.shares).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (store === site.siteId || share <= own) continue;
      const gap = row.weight * (share - own);
      if (!leak || gap > leak.gap)
        leak = { segment: row.segment, competitorId: store, gap };
    }
  }
  if (leak)
    finding("competitor_leakage", leak.segment, {
      runIds: DAYS.map((day) => site.representative[day].runId),
      hourBlocks: fullDayBlocks(request, site),
      segment: leak.segment,
      competitorId: leak.competitorId,
      summary:
        site.demandSource === "jev"
          ? "Competitor leakage: in Jev panel answers, this segment more often chooses a competitor than this site."
          : "Competitor leakage: in Huff fallback shares, this segment more often chooses a competitor than this site.",
      references: [site.siteId, leak.competitorId].map((storeId) => ({
        kind: "segment_share" as const,
        comparisonId,
        siteId: site.siteId,
        segment: leak!.segment,
        storeId,
      })),
    });
  return findings;
}

function walkaways(finding: DiagnosisFinding, site: SiteEvaluation) {
  return finding.hourBlocks.reduce((sum, block) => {
    const hourly = site.representative[block.day].hourly;
    return (
      sum +
      hourly
        .filter((h) => h.hour >= block.startHour && h.hour < block.endHour)
        .reduce((total, h) => total + h.abandoned, 0)
    );
  }, 0);
}

function proposeExperiments(
  scenario: Scenario,
  request: EvaluationRequest,
  result: EvaluationResult,
  findings: DiagnosisFinding[],
): DiagnosisExperiment[] {
  const experiments: DiagnosisExperiment[] = [];
  const configOf = (siteId: string) =>
    request.sites.find((s) => s.siteId === siteId)!.config;
  const siteOf = (siteId: string) =>
    result.sites.find((s) => s.siteId === siteId)!;
  const push = (experiment: DiagnosisExperiment) => {
    if (experiments.length >= MAX_EXPERIMENTS) return;
    if (
      experiments.some(
        (e) =>
          e.tool === experiment.tool &&
          isDeepStrictEqual(e.args, experiment.args),
      )
    )
      return;
    const schema =
      experiment.tool === "find_sites"
        ? CopilotReadSchemas.find_sites
        : CopilotMutationSchemas[experiment.tool];
    schema.parse(experiment.args);
    experiments.push(DiagnosisExperimentSchema.parse(experiment));
  };
  const rationale = (text: string) => text.replace(/\d/g, "").trim();

  const capacity = findings
    .filter((f) => f.bottleneck === "capacity_limited")
    .sort(
      (a, b) =>
        walkaways(b, siteOf(b.siteId)) - walkaways(a, siteOf(a.siteId)) ||
        a.id.localeCompare(b.id),
    );
  if (capacity[0]) {
    const target = capacity[0];
    const config = configOf(target.siteId);
    const n = config.stations.planned + 1;
    const fits = request.sites.every(
      (s) =>
        Math.floor(
          s.config.stations.usableSf / s.config.stations.sfPerStation,
        ) >= n,
    );
    const effect = {
      siteId: target.siteId,
      metric:
        target.hourBlocks[0].day === "weekday"
          ? ("weekdayAbandonmentRate" as const)
          : ("monthlyServedCustomers" as const),
      direction:
        target.hourBlocks[0].day === "weekday"
          ? ("decrease" as const)
          : ("increase" as const),
    };
    if (fits && scenario.layoutId === null)
      push({
        id: `${target.id}:stations`,
        title: "Add one station to absorb the busy-hour line",
        findingIds: [target.id],
        tool: "set_stations",
        args: {
          scenario_id: scenario.id,
          n,
          rationale: rationale(
            "Diagnosis found capacity-limited hours where walk-aways grow with the line; one more station should serve them.",
          ),
        },
        expectedEffect: effect,
        requiresRun: true,
      });
    else
      push({
        id: `${target.id}:larger-space`,
        title: "Look for a space with room for another station",
        findingIds: [target.id],
        tool: "find_sites",
        args: {
          scenario_id: scenario.id,
          preferences: { minSizeSqFt: n * config.stations.sfPerStation },
        },
        expectedEffect: effect,
        requiresRun: false,
      });
  }

  const rent = findings.find((f) => f.bottleneck === "rent_limited");
  if (rent) {
    const lease = configOf(rent.siteId).lease;
    const monthlyRentCents = Math.floor(
      (lease.sf * lease.askingRentUsdPerSfYear * 100) / 12,
    );
    if (monthlyRentCents > 1)
      push({
        id: `${rent.id}:cheaper`,
        title: "Find a cheaper space than this lease",
        findingIds: [rent.id],
        tool: "find_sites",
        args: {
          scenario_id: scenario.id,
          preferences: { rentCeilingCents: monthlyRentCents - 1 },
        },
        expectedEffect: {
          siteId: rent.siteId,
          metric: "monthlyContributionUsd",
          direction: "increase",
        },
        requiresRun: false,
      });
  }

  // An idle block at the start or end of the day can be trimmed with set_hours.
  for (const finding of findings.filter(
    (f) => f.bottleneck === "demand_limited",
  )) {
    const block = finding.hourBlocks[0];
    const hours = configOf(finding.siteId).hours[block.day];
    const open = openHours(hours);
    const atOpen = block.startHour === open[0];
    const atClose = block.endHour === open.at(-1)! + 1;
    if (atOpen === atClose) continue;
    const next = atOpen
      ? { open: block.endHour * 60, close: hours.closeMin }
      : { open: hours.openMin, close: block.startHour * 60 };
    if (next.close - next.open < 120) continue;
    push({
      id: `${finding.id}:hours`,
      title: atOpen
        ? "Open later, when customers arrive"
        : "Close earlier, after the last busy hour",
      findingIds: [finding.id],
      tool: "set_hours",
      args: {
        scenario_id: scenario.id,
        day_type: block.day,
        open: next.open,
        close: next.close,
        rationale: rationale(
          "Diagnosis found idle stations at the edge of the day; trimming those hours saves labor.",
        ),
      },
      expectedEffect: {
        siteId: finding.siteId,
        metric: "monthlyContributionUsd",
        direction: "increase",
      },
      requiresRun: true,
    });
  }

  const leak = findings.find((f) => f.bottleneck === "competitor_leakage");
  if (leak)
    push({
      id: `${leak.id}:alternatives`,
      title: "Compare other candidate spaces for this segment",
      findingIds: [leak.id],
      tool: "find_sites",
      args: { scenario_id: scenario.id, preferences: {} },
      expectedEffect: {
        siteId: leak.siteId,
        metric: "monthlyServedCustomers",
        direction: "increase",
      },
      requiresRun: false,
    });
  return experiments;
}

/** Classifies every site and hour block of one verified saved comparison. */
export function diagnose(
  scenario: Scenario,
  record: StoredComparison,
): Diagnosis {
  const { request, result } = verifyScope(scenario, record);
  const findings: DiagnosisFinding[] = [];
  for (const siteId of result.ranking) {
    const site = result.sites.find((s) => s.siteId === siteId);
    if (site) findings.push(...siteFindings(record.id, request, site));
  }
  const kept = findings.slice(0, MAX_FINDINGS);
  return {
    scenarioId: scenario.id,
    comparisonId: record.id,
    demandSource: result.demandSource,
    findings: kept,
    experiments: proposeExperiments(scenario, request, result, kept),
    warnings: [
      "REPRESENTATIVE_RUN_ONLY",
      ...(result.demandSource === "huff"
        ? (["HUFF_FALLBACK_DEMAND"] as const)
        : []),
      ...(kept.length ? [] : (["NO_BOTTLENECK_FOUND"] as const)),
    ],
  };
}

/** Whether a child scenario applies exactly this experiment's change to its parent. */
export function experimentMatches(
  experiment: DiagnosisExperiment,
  parent: Scenario,
  child: Scenario,
): boolean {
  if (child.parentId !== parent.id || experiment.tool === "find_sites")
    return false;
  const diff = diffScenarios(parent, child);
  if (diff.sites.added.length || diff.sites.removed.length || diff.layout)
    return false;
  const changed = Object.fromEntries(
    diff.overrides.map((row) => [row.key, row.to?.value]),
  );
  if (experiment.tool === "set_stations") {
    const args = CopilotMutationSchemas.set_stations.parse(experiment.args);
    return isDeepStrictEqual(changed, { plannedStations: args.n });
  }
  const args = CopilotMutationSchemas.set_hours.parse(experiment.args);
  const prefix = `hours.${args.day_type}`;
  const before = parent.overrides.hours?.[args.day_type];
  const expected: Record<string, number> = {};
  if (before?.openMinute.value !== args.open)
    expected[`${prefix}.openMinute`] = args.open;
  if (before?.closeMinute.value !== args.close)
    expected[`${prefix}.closeMinute`] = args.close;
  return (
    Object.keys(expected).length > 0 && isDeepStrictEqual(changed, expected)
  );
}

/**
 * Diff card for a run of `child` against its diagnosed parent. Rejects stale inputs: the
 * child must be a direct, same-profile child of the parent and each comparison must
 * belong to its own scenario version. Manual and agent children with the same change
 * match the same experiment and produce the same card.
 */
export function assessExperiment(input: {
  parent: Scenario;
  parentComparison: StoredComparison;
  child: Scenario;
  childComparison: StoredComparison;
}): ExperimentDiffCard {
  const { parent, child } = input;
  if (
    child.parentId !== parent.id ||
    child.projectId !== parent.projectId ||
    child.profileVersion !== parent.profileVersion
  )
    throw new DiagnosisScopeError(
      "The experiment is not a current child of the diagnosed scenario",
    );
  const base = verifyScope(parent, input.parentComparison);
  const next = verifyScope(child, input.childComparison);
  if (base.result.profileId !== next.result.profileId)
    throw new DiagnosisScopeError("The experiment used another profile");
  const diagnosis = diagnose(parent, input.parentComparison);
  const experiment = diagnosis.experiments.find((e) =>
    experimentMatches(e, parent, child),
  );
  const effect = experiment?.expectedEffect ?? {
    siteId: base.result.ranking[0],
    metric: "monthlyContributionUsd" as const,
    direction: "increase" as const,
  };
  const before = base.result.sites.find((s) => s.siteId === effect.siteId);
  const after = next.result.sites.find((s) => s.siteId === effect.siteId);
  if (!before || !after)
    throw new DiagnosisScopeError("The experiment no longer includes the site");
  const delta = after[effect.metric].mean - before[effect.metric].mean;
  const tolerance = 1e-9 * Math.max(1, Math.abs(before[effect.metric].mean));
  const signed = effect.direction === "decrease" ? -delta : delta;
  const verdict =
    signed > tolerance
      ? "improved"
      : signed < -tolerance
        ? "worse"
        : "no_change";
  const metrics = [
    ...new Set([
      effect.metric,
      "weekdayAbandonmentRate",
      "monthlyServedCustomers",
      "monthlyContributionUsd",
    ] as const),
  ];
  return ExperimentDiffCardSchema.parse({
    experimentId: experiment?.id ?? null,
    baseScenarioId: parent.id,
    experimentScenarioId: child.id,
    baseComparisonId: input.parentComparison.id,
    experimentComparisonId: input.childComparison.id,
    siteId: effect.siteId,
    metric: effect.metric,
    direction: effect.direction,
    verdict,
    winner: verdict === "improved",
    references: metrics.map((metric) => ({
      kind: "comparison_delta",
      comparisonIdA: input.parentComparison.id,
      comparisonIdB: input.childComparison.id,
      siteId: effect.siteId,
      metric,
      statistic: "mean",
    })),
  });
}

/** Only winners are reported as diff cards; the human still chooses Keep or Revert. */
export function experimentWinners(
  cards: readonly ExperimentDiffCard[],
): ExperimentDiffCard[] {
  return cards.filter((card) => card.winner);
}
