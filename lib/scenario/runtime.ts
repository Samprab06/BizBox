import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { BusinessProfileSchema } from "@/lib/contracts";
import { getDb } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { assemblePostgresEvaluation } from "@/lib/evaluation/assemble-db";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createPostgresLayoutRepository } from "@/lib/layout/repository";
import { createScenarioPreparer } from "./prepare";
import { createPostgresScenarioRepository } from "./repository";
import { createPostgresScenarioExecutionStore } from "./run-store-postgres";
import { createScenarioRunner, DEFAULT_SCENARIO_RUN_BUDGET_UNITS } from "./run";

export function readScenarioRunBudgetUnits(
  env: Record<string, string | undefined>,
) {
  const raw = env.SCENARIO_RUN_BUDGET_UNITS?.trim();
  if (!raw) return DEFAULT_SCENARIO_RUN_BUDGET_UNITS;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value > 10_000_000)
    throw new Error("Invalid scenario run budget configuration");
  return value;
}

/** All database/provider calls remain lazy, after validated route input. */
export function createPostgresScenarioRunner() {
  const layouts = createPostgresLayoutRepository();
  return createScenarioRunner({
    scenarios: createPostgresScenarioRepository(),
    executions: createPostgresScenarioExecutionStore(),
    comparisons: createPostgresComparisonStore(),
    newId: () => `scenario_run_${randomUUID()}`,
    budgetUnits: readScenarioRunBudgetUnits(process.env),
    prepare: createScenarioPreparer({
      async loadProfile(projectId, version) {
        const [row] = await getDb()
          .select()
          .from(profiles)
          .where(
            and(
              eq(profiles.projectId, projectId),
              eq(profiles.version, version),
            ),
          )
          .limit(1);
        if (!row) return null;
        const snapshot = BusinessProfileSchema.parse(row.snapshot);
        if (
          snapshot.id !== row.id ||
          snapshot.projectId !== row.projectId ||
          snapshot.version !== row.version
        )
          throw new Error("Stored profile identity mismatch");
        return snapshot;
      },
      loadLayout: (projectId, id) => layouts.get(projectId, id),
      assemble: assemblePostgresEvaluation,
    }),
  });
}
