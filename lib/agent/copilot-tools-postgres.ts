import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { BusinessProfileSchema } from "@/lib/contracts";
import { profiles } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { loadSiteInventory } from "@/app/api/sites/inventory";
import { searchSites } from "@/lib/data/sites";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { repriceBehaviorTable } from "@/lib/evaluation/evaluate";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createScenarioService } from "@/lib/scenario/service";
import { createPostgresScenarioRunner } from "@/lib/scenario/runtime";
import { createPostgresLayoutRepository } from "@/lib/layout/repository";
import { applyLayoutToConfig } from "@/lib/layout";
import { createPostgresInvestigationToolDependencies } from "./tools-postgres";
import { createCopilotTools } from "./copilot-registry";
import type { CopilotMutationDependencies } from "./copilot-tools";
import type { CopilotReadDependencies } from "./copilot-read-tools";

/** Lazy production composition over existing scoped stores; construction performs no I/O. */
export function createPostgresCopilotToolDependencies(
  hooks: Pick<CopilotReadDependencies, "focusView"> = {},
) {
  const repository = createPostgresScenarioRepository();
  const scenarios = createScenarioService({ repository, newId: randomUUID });
  const comparisons = createPostgresComparisonStore();
  const investigation = createPostgresInvestigationToolDependencies();
  const layouts = createPostgresLayoutRepository();
  async function profile(projectId: string, version: number) {
    const [row] = await getDb()
      .select()
      .from(profiles)
      .where(
        and(eq(profiles.projectId, projectId), eq(profiles.version, version)),
      )
      .limit(1);
    if (!row) throw new Error("Profile snapshot unavailable");
    const value = BusinessProfileSchema.parse(row.snapshot);
    if (
      value.projectId !== projectId ||
      value.version !== version ||
      value.id !== row.id
    )
      throw new Error("Profile snapshot scope mismatch");
    return value;
  }
  const comparisonForScenario: NonNullable<
    CopilotReadDependencies["comparisonForScenario"]
  > = async (projectId, scenarioId, signal) => {
    const runs = await repository.listRuns(projectId, scenarioId);
    signal.throwIfAborted();
    const latest = [...runs]
      .reverse()
      .find((run) => run.status === "succeeded" && run.comparisonId);
    if (!latest?.comparisonId) return null;
    const record = await comparisons.load(projectId, latest.comparisonId);
    signal.throwIfAborted();
    if (!record?.evaluation.assembly?.scenario?.id) return null;
    return {
      ...record,
      copilotBinding: {
        projectId,
        scenarioId,
        comparisonId: record.id,
        executionId: latest.id,
      },
    };
  };
  const mutations: CopilotMutationDependencies = {
    scenarios,
    async validateCandidates(projectId, siteIds, signal, scenario) {
      if (!scenario || scenario.projectId !== projectId)
        throw new Error("Scenario scope required");
      const snapshot = await profile(projectId, scenario.profileVersion);
      signal.throwIfAborted();
      const inventory = await loadSiteInventory();
      signal.throwIfAborted();
      const result = searchSites(
        { profile: snapshot },
        {
          ...inventory,
          spaces: inventory.spaces.filter((space) =>
            siteIds.includes(space.id),
          ),
        },
      );
      return {
        candidateIds: result.candidates.map((row) => row.candidate.id),
        evidenceIds: result.candidates.flatMap((row) => row.evidenceIds),
      };
    },
    async stationCapacity(projectId, scenario, signal) {
      const snapshot = await profile(projectId, scenario.profileVersion);
      const assembled = await investigation.assemble(
        snapshot,
        scenario.siteIds,
        { mode: "huff" },
        signal,
      );
      const layout = scenario.layoutId
        ? await layouts.get(projectId, scenario.layoutId)
        : null;
      if (
        scenario.layoutId &&
        (!layout ||
          !scenario.siteIds.includes(layout.siteId) ||
          layout.category !== snapshot.category)
      )
        throw new Error("Layout scope mismatch");
      signal.throwIfAborted();
      return assembled.request.sites.map((site) => {
        const selected = layout?.siteId === site.siteId;
        const config = selected
          ? applyLayoutToConfig(layout, site.config)
          : site.config;
        const capacityEvidence =
          assembled.assumptions[`sites.${site.siteId}.config.stations.usableSf`]
            ?.evidenceIds ?? [];
        return {
          siteId: site.siteId,
          maxStations: Math.floor(
            config.stations.usableSf / config.stations.sfPerStation,
          ),
          layoutId: selected ? layout.layoutId : null,
          ...(selected ? { layoutStations: config.stations.planned } : {}),
          evidenceIds: [
            ...capacityEvidence,
            ...(selected ? [`layout:${layout.layoutId}`] : []),
            `profile:${snapshot.id}`,
          ],
        };
      });
    },
    async priceAcceptance(projectId, scenario, change, signal) {
      if (change.kind === "price_tier")
        return { status: "tier_requires_run", comparisonId: null, siteIds: [] };
      const record = await comparisonForScenario(
        projectId,
        scenario.id,
        signal,
      );
      if (
        !record ||
        record.evaluation.request.profileVersion !== scenario.profileVersion ||
        record.evaluation.result.profileVersion !== scenario.profileVersion ||
        record.evaluation.result.projectId !== projectId ||
        record.comparison.projectId !== projectId ||
        record.comparison.id !== record.id ||
        record.evaluation.request.profileId !==
          record.evaluation.result.profileId ||
        record.comparison.profileId !== record.evaluation.request.profileId ||
        record.evaluation.request.projectId !== projectId ||
        record.evaluation.assembly?.scenario?.layoutId !== scenario.layoutId ||
        !isDeepStrictEqual(
          record.evaluation.assembly?.scenario?.overrides,
          scenario.overrides,
        )
      )
        return { status: "unavailable", comparisonId: null, siteIds: [] };
      const sites = record.evaluation.request.sites;
      const valid =
        sites.length === scenario.siteIds.length &&
        sites.every(
          (site) =>
            scenario.siteIds.includes(site.siteId) &&
            site.behaviorTable?.personas.length &&
            site.behaviorTable.personas.every(
              (persona) => persona.priceAcceptance.length > 0,
            ),
        );
      if (!valid)
        return { status: "unavailable", comparisonId: null, siteIds: [] };
      // Same cached curve interpolation as price sensitivity. No panel or evaluation call.
      sites.forEach((site) =>
        repriceBehaviorTable(
          site.behaviorTable!,
          site.config.prices.avgTicketUsd,
          change.averageTicketCents / 100,
        ),
      );
      return {
        status: "cached_curve",
        comparisonId: record.id,
        siteIds: sites.map((site) => site.siteId),
      };
    },
  };
  const reads: CopilotReadDependencies = {
    scenarios,
    comparisonForScenario,
    ...hooks,
    async search(projectId, scenario, preferences, signal) {
      const snapshot = await profile(projectId, scenario.profileVersion);
      signal.throwIfAborted();
      const { minSizeSqFt, maxSizeSqFt, limit, rentCeilingCents, mustHaves } =
        preferences;
      const searchProfile = structuredClone(snapshot);
      const provenance = {
        origin: "default" as const,
        evidenceIds: [`copilot-search:${scenario.id}`],
      };
      if (rentCeilingCents !== undefined)
        searchProfile.economics.monthlyRentCeilingCents = {
          ...searchProfile.economics.monthlyRentCeilingCents,
          value: rentCeilingCents,
          ...provenance,
        };
      for (const key of [
        "frontage",
        "corner",
        "parking",
        "groundFloor",
      ] as const)
        if (mustHaves?.[key] !== undefined)
          searchProfile.mustHaves[key] = {
            value: mustHaves[key],
            unit: "boolean",
            ...provenance,
          };
      const result = await investigation.search(
        searchProfile,
        { minSizeSqFt, maxSizeSqFt, limit },
        signal,
      );
      return {
        projectId,
        scenarioId: scenario.id,
        profileId: snapshot.id,
        profileVersion: snapshot.version,
        result,
      };
    },
    async runForId(projectId, runId, signal, scenarioId) {
      const comparison = await investigation.comparisonForRun(projectId, runId);
      signal.throwIfAborted();
      const run = comparison?.runs.find((run) => run.id === runId);
      if (!comparison || !run) return null;
      if (!scenarioId) return { comparison, run };
      const executions = await repository.listRuns(projectId, scenarioId);
      signal.throwIfAborted();
      const linked = executions.find(
        (execution) =>
          execution.status === "succeeded" &&
          execution.comparisonId === comparison.id,
      );
      if (!linked) return null;
      return {
        comparison: {
          ...comparison,
          copilotBinding: {
            projectId,
            scenarioId,
            comparisonId: comparison.id,
            executionId: linked.id,
          },
        },
        run,
      };
    },
  };
  return {
    mutations,
    reads,
    runs: { scenarios, runner: createPostgresScenarioRunner() },
  };
}

export function createPostgresCopilotTools(
  hooks: Pick<CopilotReadDependencies, "focusView"> = {},
) {
  return createCopilotTools(createPostgresCopilotToolDependencies(hooks));
}
