import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import {
  SiteComparisonSchema,
  SiteRunSchema,
  type SiteRun,
} from "@/lib/contracts";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
  HourlyStatSchema,
} from "@/lib/contracts/evaluation";
import { ScenarioSchema, type Scenario } from "@/lib/contracts/scenario";
import {
  SiteSearchResultSchema,
  type SiteSearchResult,
} from "@/lib/contracts/sites";
import {
  CopilotReadSchemas,
  CopilotReadResultSchema,
  ComparisonMetricSchema,
  HourMetricSchema,
  CopilotComparisonBindingSchema,
  type CopilotReadToolName,
  type CopilotReadResult,
  type CopilotSearchPreferences,
  type CopilotFocusInput,
} from "@/lib/contracts/copilot-read-tools";
import type { ScenarioService } from "@/lib/scenario/service";
import type { StoredComparison } from "@/lib/evaluation/store";
import type { CopilotMutationContext } from "./copilot-tools";
import type { ExperimentDiffCard } from "@/lib/contracts/copilot-read-tools";
import { assessExperiment, diagnose, DiagnosisScopeError } from "./diagnose";

export type ScopedSiteSearchResult = {
  projectId: string;
  scenarioId: string;
  profileId: string;
  profileVersion: number;
  result: SiteSearchResult;
};
export type CopilotStoredComparison = StoredComparison & {
  /** Scoped execution receipt; the saved source assembly is never rewritten for a cache hit. */
  copilotBinding?: z.infer<typeof CopilotComparisonBindingSchema>;
};
export type CopilotReadDependencies = {
  scenarios: Pick<ScenarioService, "get">;
  search?: (
    projectId: string,
    scenario: Scenario,
    preferences: CopilotSearchPreferences,
    signal: AbortSignal,
  ) => Promise<ScopedSiteSearchResult>;
  comparisonForScenario?: (
    projectId: string,
    scenarioId: string,
    signal: AbortSignal,
  ) => Promise<CopilotStoredComparison | null>;
  runForId?: (
    projectId: string,
    runId: string,
    signal: AbortSignal,
    scenarioId?: string,
  ) => Promise<{ comparison: CopilotStoredComparison; run: SiteRun } | null>;
  /** HAC-88 owns client dispatch and confirmation, not this registry. */
  focusView?: (
    projectId: string,
    scenario: Scenario,
    input: CopilotFocusInput,
    signal: AbortSignal,
  ) => Promise<{ actionId: string }>;
};
type FailureCode = Extract<CopilotReadResult, { status: "rejected" }>["code"];
class ReadBoundaryError extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}
const id = z.string().trim().min(1).max(200);
const unsupported = (
  code: Extract<
    CopilotReadResult,
    { status: "unsupported" }
  >["code"] = "ADAPTER_UNAVAILABLE",
): CopilotReadResult => ({
  status: "unsupported",
  code,
  message:
    "A verified adapter or saved trace is not available for this operation.",
});
const sameIds = (a: string[], b: string[]) =>
  new Set(a).size === a.length &&
  new Set(b).size === b.length &&
  a.length === b.length &&
  a.every((x) => b.includes(x));
const requireScope = (condition: boolean) => {
  if (!condition) throw new ReadBoundaryError("SCOPE_CONFLICT");
};
const descriptions: Record<CopilotReadToolName, string> = {
  find_sites:
    "Find scoped candidates from a saved scenario. Returns IDs and evidence references only; near search is unsupported.",
  compare_scenarios:
    "Compare two completed, same-profile scenario evaluations through typed metric and interval-delta references, never invented numeric claims.",
  explain_hour:
    "Read one saved representative run's hourly trace, not the all-seed aggregate; returns metric references only.",
  diagnose:
    "Classify each site and hour block of the scenario's verified saved run (demand-, capacity- or rent-limited, competitor leakage). Findings cite run IDs, hour blocks and metric references; up to three experiments name existing tools to propose. A child of a diagnosed scenario also gets a diff card against its parent. Never runs anything.",
  focus_view:
    "Delegate a scoped view request to the optional HAC-88 client adapter; this tool does not dispatch client actions itself.",
};

/** No database, simulation, geocoding, model or provider calls: all reads use trusted adapters. */
export function createCopilotReadTools(deps: CopilotReadDependencies) {
  async function scenarioFor(
    scenarioId: string,
    context: CopilotMutationContext,
    checkActive = true,
  ) {
    const row = ScenarioSchema.parse(
      await deps.scenarios.get(context.projectId, scenarioId),
    );
    context.signal.throwIfAborted();
    requireScope(row.id === scenarioId && row.projectId === context.projectId);
    if (
      (checkActive &&
        context.scenarioId !== undefined &&
        context.scenarioId !== row.id) ||
      (context.profileVersion !== undefined &&
        context.profileVersion !== row.profileVersion)
    )
      throw new ReadBoundaryError("STALE_CONTEXT");
    return row;
  }
  function verifyComparison(
    record: CopilotStoredComparison,
    scenario: Scenario,
    context: CopilotMutationContext,
  ) {
    id.parse(record.id);
    const request = EvaluationRequestSchema.parse(record.evaluation.request);
    const result = EvaluationResultSchema.parse(record.evaluation.result);
    const comparison = SiteComparisonSchema.parse(record.comparison);
    const runs = record.runs.map((run) => SiteRunSchema.parse(run));
    const snapshot = record.evaluation.assembly?.scenario;
    const binding =
      record.copilotBinding === undefined
        ? undefined
        : CopilotComparisonBindingSchema.parse(record.copilotBinding);
    if (binding)
      requireScope(
        binding.projectId === context.projectId &&
          binding.scenarioId === scenario.id &&
          binding.comparisonId === record.id,
      );
    requireScope(
      !!snapshot &&
        (snapshot.id === scenario.id || binding?.scenarioId === scenario.id) &&
        snapshot.layoutId === scenario.layoutId &&
        isDeepStrictEqual(snapshot.overrides, scenario.overrides) &&
        comparison.id === record.id &&
        request.projectId === context.projectId &&
        result.projectId === context.projectId &&
        comparison.projectId === context.projectId &&
        request.profileVersion === scenario.profileVersion &&
        result.profileVersion === scenario.profileVersion &&
        request.profileId === result.profileId &&
        comparison.profileId === request.profileId &&
        sameIds(
          scenario.siteIds,
          request.sites.map((s) => s.siteId),
        ) &&
        sameIds(
          scenario.siteIds,
          result.sites.map((s) => s.siteId),
        ) &&
        sameIds(
          scenario.siteIds,
          comparison.results.map((s) => s.siteId),
        ) &&
        sameIds(scenario.siteIds, result.ranking) &&
        sameIds(
          comparison.runIds,
          runs.map((r) => r.id),
        ) &&
        sameIds(
          runs.map((r) => r.id),
          result.sites.flatMap((s) => [
            s.representative.weekday.runId,
            s.representative.weekend.runId,
          ]),
        ),
    );
    requireScope(
      result.sites.every(
        (site) =>
          result.ranking[site.rank - 1] === site.siteId &&
          comparison.results.some(
            (row) => row.siteId === site.siteId && row.rank === site.rank,
          ) &&
          (["weekday", "weekend"] as const).every((day) => {
            const rep = site.representative[day];
            return runs.some(
              (run) =>
                run.id === rep.runId &&
                run.siteId === site.siteId &&
                run.dayType === day &&
                run.seed === rep.seed,
            );
          }),
      ),
    );
    requireScope(
      runs.every(
        (run) =>
          run.projectId === context.projectId &&
          run.profileId === request.profileId &&
          scenario.siteIds.includes(run.siteId) &&
          run.modelVersion === result.modelVersion &&
          comparison.results.some(
            (row) => row.siteId === run.siteId && row.runIds.includes(run.id),
          ),
      ),
    );
    return record;
  }
  async function comparisonFor(
    scenario: Scenario,
    context: CopilotMutationContext,
  ) {
    const record = await deps.comparisonForScenario!(
      context.projectId,
      scenario.id,
      context.signal,
    );
    context.signal.throwIfAborted();
    if (!record) throw new ReadBoundaryError("NOT_FOUND");
    return verifyComparison(record, scenario, context);
  }
  async function runFor(runId: string, context: CopilotMutationContext) {
    const found = await deps.runForId!(
      context.projectId,
      runId,
      context.signal,
      context.scenarioId,
    );
    context.signal.throwIfAborted();
    if (!found) throw new ReadBoundaryError("NOT_FOUND");
    const scenarioId =
      found.comparison.copilotBinding?.scenarioId ??
      found.comparison.evaluation.assembly?.scenario?.id;
    if (!scenarioId) throw new ReadBoundaryError("SCOPE_CONFLICT");
    const scenario = await scenarioFor(scenarioId, context);
    verifyComparison(found.comparison, scenario, context);
    const run = SiteRunSchema.parse(found.run);
    requireScope(
      run.id === runId &&
        found.comparison.runs.some(
          (row) =>
            row.id === runId &&
            JSON.stringify(SiteRunSchema.parse(row)) === JSON.stringify(run),
        ),
    );
    return { scenario, comparison: found.comparison, run };
  }
  return {
    definitions: (Object.keys(CopilotReadSchemas) as CopilotReadToolName[]).map(
      (name) => ({
        name,
        schema: CopilotReadSchemas[name],
        description: descriptions[name],
      }),
    ),
    async execute(
      name: CopilotReadToolName,
      args: unknown,
      context: CopilotMutationContext,
    ): Promise<CopilotReadResult> {
      context.signal.throwIfAborted();
      try {
        id.parse(context.projectId);
        id.parse(context.evidenceId);
        if (context.scenarioId !== undefined) id.parse(context.scenarioId);
        if (context.profileVersion !== undefined)
          z.number().int().positive().parse(context.profileVersion);
        if (!Object.hasOwn(CopilotReadSchemas, name))
          throw new ReadBoundaryError("INVALID_INPUT");
        CopilotReadSchemas[name].parse(args);
        let output: CopilotReadResult;
        switch (name) {
          case "find_sites": {
            const input = CopilotReadSchemas.find_sites.parse(args);
            const scenario = await scenarioFor(input.scenario_id, context);
            if (
              input.preferences.near !== undefined ||
              input.preferences.area !== undefined
            )
              return unsupported("NEAR_SEARCH_UNAVAILABLE");
            if (!deps.search) return unsupported();
            const raw = await deps.search(
              context.projectId,
              scenario,
              input.preferences,
              context.signal,
            );
            context.signal.throwIfAborted();
            const scoped = z
              .object({
                projectId: id,
                scenarioId: id,
                profileId: id,
                profileVersion: z.number().int().positive(),
                result: SiteSearchResultSchema,
              })
              .strict()
              .parse(raw);
            requireScope(
              scoped.projectId === context.projectId &&
                scoped.scenarioId === scenario.id &&
                scoped.profileVersion === scenario.profileVersion,
            );
            const { result } = scoped;
            const evidence = new Set(result.evidence.map((e) => e.id));
            requireScope(
              sameIds(
                result.candidates.map((c) => c.candidate.id),
                result.candidates.map((c) => c.candidate.id),
              ) &&
                result.candidates.length <= (input.preferences.limit ?? 8) &&
                result.candidates.every(
                  (c) =>
                    c.candidate.projectId === context.projectId &&
                    [...c.evidenceIds, c.scoreEvidenceId].every((e) =>
                      evidence.has(e),
                    ),
                ),
            );
            output = {
              status: "found",
              scenarioId: scenario.id,
              siteIds: result.candidates.map((c) => c.candidate.id),
              references: result.candidates.map((c) => ({
                kind: "candidate",
                projectId: context.projectId,
                scenarioId: scenario.id,
                siteId: c.candidate.id,
                evidenceIds: [
                  ...new Set([...c.evidenceIds, c.scoreEvidenceId]),
                ],
              })),
              warnings: result.candidates.length ? [] : ["NO_CANDIDATES"],
            };
            break;
          }
          case "compare_scenarios": {
            const { a, b } = CopilotReadSchemas.compare_scenarios.parse(args);
            if (
              context.scenarioId !== undefined &&
              context.scenarioId !== a &&
              context.scenarioId !== b
            )
              throw new ReadBoundaryError("STALE_CONTEXT");
            const sa = await scenarioFor(a, context, false),
              sb = await scenarioFor(b, context, false);
            requireScope(sa.profileVersion === sb.profileVersion);
            if (!deps.comparisonForScenario) return unsupported();
            const ca = await comparisonFor(sa, context),
              cb = await comparisonFor(sb, context);
            requireScope(
              ca.evaluation.result.profileId === cb.evaluation.result.profileId,
            );
            const sitesA = ca.evaluation.result.ranking,
              sitesB = cb.evaluation.result.ranking;
            const unmatchedSiteIdsA = sitesA.filter((s) => !sitesB.includes(s)),
              unmatchedSiteIdsB = sitesB.filter((s) => !sitesA.includes(s));
            const references: Extract<
              CopilotReadResult,
              { status: "compared" }
            >["references"] = [];
            for (const [scenario, record] of [
              [sa, ca],
              [sb, cb],
            ] as const) {
              references.push({
                kind: "scenario_value",
                scenarioId: scenario.id,
                path: "siteIds",
              });
              for (const site of record.evaluation.result.sites)
                for (const metric of ComparisonMetricSchema.options)
                  for (const statistic of [
                    "low",
                    "mean",
                    "median",
                    "high",
                  ] as const)
                    references.push({
                      kind: "comparison_metric",
                      comparisonId: record.id,
                      siteId: site.siteId,
                      metric,
                      statistic,
                    });
            }
            for (const siteId of sitesA.filter((s) => sitesB.includes(s)))
              for (const metric of ComparisonMetricSchema.options)
                for (const statistic of [
                  "low",
                  "mean",
                  "median",
                  "high",
                ] as const)
                  references.push({
                    kind: "comparison_delta",
                    comparisonIdA: ca.id,
                    comparisonIdB: cb.id,
                    siteId,
                    metric,
                    statistic,
                  });
            output = {
              status: "compared",
              scenarioIdA: a,
              scenarioIdB: b,
              comparisonIdA: ca.id,
              comparisonIdB: cb.id,
              rankingChanged: JSON.stringify(sitesA) !== JSON.stringify(sitesB),
              unmatchedSiteIdsA,
              unmatchedSiteIdsB,
              references,
              warnings: [
                "INTERVAL_DELTAS_NOT_PAIRED_CONFIDENCE",
                ...(unmatchedSiteIdsA.length || unmatchedSiteIdsB.length
                  ? ["UNMATCHED_SITES" as const]
                  : []),
              ],
            };
            break;
          }
          case "explain_hour": {
            const input = CopilotReadSchemas.explain_hour.parse(args);
            if (!deps.runForId) return unsupported();
            const { scenario, comparison, run } = await runFor(
              input.run_id,
              context,
            );
            if (input.day !== undefined && input.day !== run.dayType)
              throw new ReadBoundaryError("INVALID_INPUT");
            const config = comparison.evaluation.request.sites.find(
              (s) => s.siteId === run.siteId,
            )?.config;
            const rep = comparison.evaluation.result.sites.find(
              (s) => s.siteId === run.siteId,
            )?.representative[run.dayType];
            if (!config || !rep || rep.runId !== run.id)
              return unsupported("HOUR_UNAVAILABLE");
            const hours = config.hours[run.dayType];
            if (
              input.hour * 60 >= hours.closeMin ||
              (input.hour + 1) * 60 <= hours.openMin
            )
              return unsupported("HOUR_UNAVAILABLE");
            const matching = rep.hourly.filter((h) => h.hour === input.hour);
            if (matching.length !== 1) return unsupported("HOUR_UNAVAILABLE");
            const trace = HourlyStatSchema.parse(matching[0]);
            const metrics = HourMetricSchema.options.filter(
              (metric) =>
                metric !== "meanWaitMin" || trace.meanWaitMin !== null,
            );
            output = {
              status: "explained",
              scenarioId: scenario.id,
              comparisonId: comparison.id,
              runId: run.id,
              siteId: run.siteId,
              hour: input.hour,
              day: run.dayType,
              references: metrics.map((metric) => ({
                kind: "hour_metric",
                runId: run.id,
                hour: input.hour,
                metric,
              })),
              warnings: [
                "REPRESENTATIVE_RUN_ONLY",
                ...(trace.meanWaitMin === null
                  ? ["MISSING_HOURLY_WAIT" as const]
                  : []),
              ],
            };
            break;
          }
          case "diagnose": {
            const input = CopilotReadSchemas.diagnose.parse(args);
            const scenario = await scenarioFor(input.scenario_id, context);
            if (!deps.comparisonForScenario) return unsupported();
            const comparison = await comparisonFor(scenario, context);
            const diagnosis = diagnose(scenario, comparison);
            let experimentCard: ExperimentDiffCard | undefined;
            if (scenario.parentId !== null) {
              // Optional: the parent may have no saved run, or a stale one, which
              // only drops the card; it never fails the child's own diagnosis.
              try {
                const parent = await scenarioFor(
                  scenario.parentId,
                  context,
                  false,
                );
                const parentComparison = await comparisonFor(parent, context);
                experimentCard = assessExperiment({
                  parent,
                  parentComparison,
                  child: scenario,
                  childComparison: comparison,
                });
              } catch (error) {
                context.signal.throwIfAborted();
                if (
                  !(error instanceof ReadBoundaryError) &&
                  !(error instanceof DiagnosisScopeError) &&
                  !(
                    error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code === "not_found"
                  )
                )
                  throw error;
              }
            }
            output = {
              status: "diagnosed",
              ...diagnosis,
              ...(experimentCard ? { experimentCard } : {}),
            };
            break;
          }
          case "focus_view": {
            const input = CopilotReadSchemas.focus_view.parse(args);
            const scenario = await scenarioFor(input.scenario_id, context);
            if (input.site_id !== undefined)
              requireScope(scenario.siteIds.includes(input.site_id));
            if (!deps.focusView) return unsupported();
            if (input.run_id) {
              if (!deps.runForId) return unsupported();
              const verified = await runFor(input.run_id, context);
              requireScope(
                verified.scenario.id === scenario.id &&
                  (input.site_id === undefined ||
                    input.site_id === verified.run.siteId),
              );
            }
            if (input.view === "comparison") {
              if (!deps.comparisonForScenario) return unsupported();
              await comparisonFor(scenario, context);
            }
            const receipt = z
              .object({ actionId: id })
              .strict()
              .parse(
                await deps.focusView(
                  context.projectId,
                  scenario,
                  input,
                  context.signal,
                ),
              );
            output = {
              status: "delegated",
              scenarioId: scenario.id,
              actionId: receipt.actionId,
              warnings: [],
            };
            break;
          }
        }
        context.signal.throwIfAborted();
        return CopilotReadResultSchema.parse(output);
      } catch (error) {
        context.signal.throwIfAborted();
        const code: FailureCode =
          error instanceof ReadBoundaryError
            ? error.code
            : error instanceof DiagnosisScopeError
              ? "STALE_CONTEXT"
              : error instanceof z.ZodError
                ? "INVALID_INPUT"
                : error &&
                    typeof error === "object" &&
                    "code" in error &&
                    error.code === "not_found"
                  ? "NOT_FOUND"
                  : "UNAVAILABLE";
        return {
          status: "rejected",
          code,
          message: "The requested read could not be verified or completed.",
        };
      }
    },
  };
}
