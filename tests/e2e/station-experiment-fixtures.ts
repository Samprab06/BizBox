import type { StationExperimentRun } from "../../lib/contracts/station-experiment-run";
import { evaluateSites } from "../../lib/evaluation/evaluate";
import { buildStoredComparison } from "../../lib/evaluation/store";
import { stationExperimentsFromComparisons } from "../../lib/insights/station-experiment-producer";
import { resolveStationCount } from "../../lib/sim/engine";
import {
  liveComparisonRecord,
  liveComparisonId,
  liveCandidateIds,
} from "./live-comparison-fixtures";

// Real helper/evaluator results, authored entirely offline. Never product fallback data.
const ids = ["baseline", "plus-one", "plus-two"] as const;
const records = ids.map((id, increment) => {
  const request = structuredClone(liveComparisonRecord.evaluation.request);
  request.sites = request.sites.filter(
    (site) => site.siteId === liveCandidateIds[0],
  );
  request.sites[0].config.stations.planned += increment;
  request.sites[0].config.staff.headcount += increment;
  return buildStoredComparison(
    `station-${id}`,
    request,
    evaluateSites(request),
  );
});
const result = stationExperimentsFromComparisons({
  baseline: records[0],
  alternatives: records
    .slice(1)
    .map((comparison, index) => ({ id: ids[index + 1], comparison })),
  siteId: liveCandidateIds[0],
  dayType: "weekday",
  origins: ["default"],
});

export function stationPlan(completed = 0): StationExperimentRun {
  const source = records[0].evaluation.result;
  return {
    status: completed === 3 ? "ready" : completed > 0 ? "running" : "planned",
    source: {
      comparisonId: liveComparisonId,
      projectId: source.projectId,
      siteId: liveCandidateIds[0],
      dayType: "weekday",
      profileId: source.profileId,
      profileVersion: source.profileVersion,
      seedCount: source.seeds.length,
      seeds: source.seeds,
      synthetic: true,
      demandSource: "huff",
      sourceNotice: null,
      currentProfileVersion: source.profileVersion,
      outdated: false,
    },
    configurations: records.map((record, index) => ({
      id: ids[index],
      plannedStations:
        record.evaluation.request.sites[0].config.stations.planned,
      effectiveStations: resolveStationCount(
        record.evaluation.request.sites[0].config,
      ),
      staffHeadcount: record.evaluation.request.sites[0].config.staff.headcount,
      hours: record.evaluation.request.sites[0].config.hours,
      costUnits: source.seeds.length * 2,
      status: index < completed ? "succeeded" : "planned",
      scenarioId: `scenario-${ids[index]}`,
      runId: `run-${ids[index]}`,
      comparisonId: index < completed ? record.id : null,
      cached: false,
    })),
    nextConfigurationId: completed < 3 ? ids[completed] : null,
    confirmation: null,
    result: completed === 3 ? result : null,
    unavailable: null,
  };
}
