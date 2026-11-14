import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import { percentile, simulateDay } from "@/lib/sim/engine";
import {
  FIXTURE_SCENARIO_COUNT,
  buildFixtureSchedule,
  fixtureScenarioSeeds,
} from "@/lib/sim/fixtures/arrival-schedule";
import type { SiteConfigInput } from "@/lib/sim/contracts";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { loadRecordedExample } from "@/lib/panel/recorded-example-loader";
import {
  type RecordedJevExample,
  recordedExampleLabel,
  recordedExamplePersonas,
  recordedExampleSchedule,
} from "@/lib/panel/recorded-example";

export const comparisonId = "houston-coffee-example-v1";
const fixture = syntheticHoustonFixture;
const hours = { openMin: 420, closeMin: 900 };
// HAC-101: a recorded Jev panel, only if one is checked in. Without it the example stays Huff.
const recorded = loadRecordedExample();
const recordingFor = (sites: PreviewProject["sites"]) =>
  recorded && sites.every((s) => recorded.sites.some((r) => r.siteId === s.id))
    ? recorded
    : undefined;
/** "Recorded Jev answers, <model>, <date>" when the example runs on recorded Jev answers. */
export function exampleDemandLabel(sites: PreviewProject["sites"]) {
  const recording = recordingFor(sites);
  return recording ? recordedExampleLabel(recording) : null;
}

// A recorded panel yields far more customers than the hand-built example and the result is
// deterministic, so run each recorded scenario once per process.
const recordedRows = new Map<string, ReturnType<typeof computeExample>>();

export function exampleComparison(sites: PreviewProject["sites"], visits = 1) {
  const recording = recordingFor(sites);
  if (!recording) return computeExample(sites, visits, undefined);
  const key = `${visits}:${sites.map((s) => `${s.id}/${s.squareFeet}`).join(",")}`;
  const cached =
    recordedRows.get(key) ?? computeExample(sites, visits, recording);
  recordedRows.set(key, cached);
  return cached;
}

function computeExample(
  sites: PreviewProject["sites"],
  visits: number,
  recording: RecordedJevExample | undefined,
) {
  const rows = sites.map((site, index) => {
    const config: SiteConfigInput = {
      hours: { weekday: hours, weekend: hours },
      stations: { planned: 2, usableSf: site.squareFeet, sfPerStation: 250 },
      prices: { avgTicketUsd: 6.5 },
      staff: { headcount: 2, wageUsdPerHour: 16 },
      costs: { cogsPctOfRevenue: 0.27 },
      lease: {
        sf: site.squareFeet,
        askingRentUsdPerSfYear: index === 0 ? 31 : 24,
        tripleNet: false,
        buildoutUsd: 24000,
        leaseTermMonths: 36,
      },
      calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
    };
    const simulate = (seed: number, dayType: "weekday" | "weekend") => {
      if (recording)
        return simulateDay(
          recordedExampleSchedule(recording, site.id, {
            seed,
            dayType,
            ...hours,
            scale: visits,
          }),
          config,
        );
      // HAC-110: arrivals and stay curves come from the demand model's category time blocks
      // (HAC-74), so the replay peaks in the morning. It stays a Huff-labelled example.
      return simulateDay(
        {
          ...buildFixtureSchedule({
            siteId: site.id,
            siteIndex: index,
            seed,
            dayType,
            visits,
          }),
          demandSource: "huff",
        },
        config,
      );
    };
    const scenarios = Array.from({ length: FIXTURE_SCENARIO_COUNT }, (_, index) => {
      const seeds = fixtureScenarioSeeds(index);
      const run = simulate(seeds.weekday, "weekday");
      const monthly = computeMonthlyEconomics(config, {
        weekday: run.metrics,
        weekend: simulate(seeds.weekend, "weekend").metrics,
      });
      return { run, contribution: monthly.contributionUsd };
    }).sort((a, b) => a.contribution - b.contribution);
    const contributions = scenarios.map(({ contribution }) => contribution);
    const mean =
      contributions.reduce((sum, contribution) => sum + contribution, 0) /
      contributions.length;
    const run = scenarios[Math.floor(scenarios.length / 2)].run;
    return {
      site,
      mean,
      low: percentile(contributions, 0.05) ?? mean,
      high: percentile(contributions, 0.95) ?? mean,
      run,
      runId: `${exampleComparisonId(visits)}-${site.id}-${run.seed}`,
    };
  });
  return rows.sort((a, b) => b.mean - a.mean);
}

export function exampleComparisonId(visits: number) {
  return `${comparisonId}-${visits}`;
}

const fixturePersonas = fixture.personaSet.personas.map(
  ({ id, label }) => ({
    id,
    label,
    monthlyVisits: fixture.behaviorTable.personas.find(
      (persona) => persona.personaId === id,
    )?.expectedMonthlyVisits.value,
    destinations:
      fixture.behaviorTable.personas
        .find((persona) => persona.personaId === id)
        ?.where.map(({ destinationId, share }) => ({
          label:
            destinationId === "none"
              ? "No visit"
              : destinationId === fixture.behaviorTable.siteId
                ? "Example site"
                : "Example competitor",
          share: share.value,
        })) ?? [],
  }),
);

export const examplePersonas = recorded
  ? recordedExamplePersonas(recorded)
  : fixturePersonas;
