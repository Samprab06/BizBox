/** Offline generation only. Runtime UI imports the data module, never this script. */
import { writeFileSync } from "node:fs";
import { fixtureInsightsExperimentInput } from "../lib/insights/fixture";
import { runScheduledExperiment } from "../lib/sim/experiment";
import {
  selectStationExperiment,
  summarizeStationExperiments,
} from "../lib/insights/station-experiment";
import type { DayType } from "../lib/sim/contracts";

const data = Object.fromEntries(
  ["montrose", "heights"].map((siteId) => [
    siteId,
    Object.fromEntries(
      (["weekday", "weekend"] as const).map((dayType: DayType) => {
        const results = (stations: number) =>
          Array.from({ length: 12 }, (_, i) => {
            const { config, settings, schedules } =
              fixtureInsightsExperimentInput(siteId, i + 1, dayType);
            return runScheduledExperiment(
              config,
              {
                ...settings,
                plannedStations: stations,
                staffHeadcount: stations,
              },
              schedules,
            );
          });
        const variants = summarizeStationExperiments({
          baseline: results(2),
          alternatives: [3, 4].map((stations) => ({
            id: `stations-${stations}`,
            results: results(stations),
          })),
          origins: ["default"],
        });
        return [dayType, selectStationExperiment(variants)];
      }),
    ),
  ]),
);
writeFileSync(
  new URL("../lib/insights/station-experiment-fixture.ts", import.meta.url),
  `// Authored synthetic example, generated offline from the exact HAC-94 schedules/config.\n// Regenerate: pnpm exec tsx scripts/generate-station-experiment-fixture.ts\nimport type { StationExperimentCallout } from "@/lib/contracts/station-experiment";\nexport const STATION_EXPERIMENT_FIXTURE_SOURCE = "Authored synthetic example · same 12 seeds and baseline configuration as the adjacent example charts";\nexport const STATION_EXPERIMENT_FIXTURES: Readonly<Record<string, Readonly<Record<"weekday" | "weekend", StationExperimentCallout | null>>>> = ${JSON.stringify(data, null, 2)};\n`,
);
