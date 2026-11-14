import "server-only";
import { createStationExperimentService } from "@/lib/insights/station-experiment-service";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createPostgresScenarioExecutionStore } from "@/lib/scenario/run-store-postgres";
import { readScenarioRunBudgetUnits } from "@/lib/scenario/runtime";
import { createStationExperimentHandlers } from "./handler";
// Lazy construction avoids opening the database before route validation.
function service() {
  return createStationExperimentService({
    comparisons: createPostgresComparisonStore(),
    scenarios: createPostgresScenarioRepository(),
    executions: createPostgresScenarioExecutionStore(),
    budgetUnits: readScenarioRunBudgetUnits(process.env),
  });
}
export const stationExperimentHandlers = createStationExperimentHandlers({
  get: (...args) => service().get(...args),
  post: (...args) => service().post(...args),
});
