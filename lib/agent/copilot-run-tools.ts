import { z } from "zod";
import {
  CopilotRunScenarioSchema,
  CopilotRunResultSchema,
  type CopilotRunResult,
} from "@/lib/contracts/copilot-run-tools";
import { parseScenario } from "@/lib/scenario/model";
import type { ScenarioRunner } from "@/lib/scenario/run";
import type { ScenarioService } from "@/lib/scenario/service";
import type { CopilotMutationContext } from "./copilot-tools";

export type CopilotRunDependencies = {
  scenarios: Pick<ScenarioService, "get">;
  runner: Pick<ScenarioRunner, "start" | "advance" | "get">;
};

const scopeSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  scenarioId: z.string().trim().min(1).max(200).optional(),
  profileVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  runConfirmed: z.boolean().optional(),
  budgetConfirmed: z.boolean().optional(),
});
const rejected = (
  code: "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE",
  message: string,
): CopilotRunResult => ({ status: "rejected", code, message });

/** No new execution/cache/budget implementation: all work uses the injected runner.
 * Its start advances once; resume advances once with its existing time slice.
 * Runner has no cancellation input: cancellation gates before/after awaits prevent
 * follow-up calls and output, but do not interrupt an already running slice.
 */
export function createCopilotRunTools(deps: CopilotRunDependencies) {
  return {
    definitions: [
      {
        name: "run_scenario" as const,
        schema: CopilotRunScenarioSchema,
        description:
          "Start or resume one checkpointed scenario execution after trusted human Run approval. Project rolling-budget confirmation is separate. Returns scoped execution/comparison references, never raw simulation events.",
      },
    ],
    async execute(
      name: "run_scenario",
      args: unknown,
      context: CopilotMutationContext,
    ): Promise<CopilotRunResult> {
      context.signal.throwIfAborted();
      try {
        if (name !== "run_scenario")
          return rejected("INVALID_INPUT", "Unknown run tool.");
        const input = CopilotRunScenarioSchema.parse(args);
        const scope = scopeSchema.parse(context);
        if (
          scope.scenarioId !== undefined &&
          scope.scenarioId !== input.scenario_id
        )
          return rejected(
            "NOT_FOUND",
            "Scenario does not match the trusted scope.",
          );
        const scenario = parseScenario(
          await deps.scenarios.get(scope.projectId, input.scenario_id),
        );
        context.signal.throwIfAborted();
        if (
          scenario.projectId !== scope.projectId ||
          scenario.id !== input.scenario_id ||
          (scope.profileVersion !== undefined &&
            scenario.profileVersion !== scope.profileVersion)
        )
          return rejected(
            "NOT_FOUND",
            "Scenario does not match the trusted project/profile scope.",
          );

        // A model cannot approve its own run, even when the project budget fits.
        if (scope.runConfirmed !== true)
          return {
            status: "needs_confirmation",
            reason: "human_run",
            scenarioId: scenario.id,
          };

        let outcome;
        if (input.execution_id !== undefined) {
          const existing = await deps.runner.get(
            scope.projectId,
            scenario.id,
            input.execution_id,
          );
          context.signal.throwIfAborted();
          if (
            existing.scenarioId !== scenario.id ||
            existing.runId !== input.execution_id
          )
            return rejected(
              "NOT_FOUND",
              "Execution does not match the trusted scenario scope.",
            );
          // Even terminal reads must go through the scoped runner, not an alternate cache.
          outcome =
            existing.status === "succeeded" || existing.status === "failed"
              ? existing
              : await deps.runner.advance(
                  scope.projectId,
                  scenario.id,
                  input.execution_id,
                );
        } else {
          outcome = await deps.runner.start(scope.projectId, scenario.id, {
            confirm: scope.budgetConfirmed === true,
            ...(scope.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: scope.idempotencyKey }),
          });
        }
        context.signal.throwIfAborted();
        if (outcome.status === "needs_confirmation")
          return {
            status: "needs_confirmation",
            reason: "project_budget",
            scenarioId: scenario.id,
          };
        if (
          outcome.scenarioId !== scenario.id ||
          (input.execution_id !== undefined &&
            outcome.runId !== input.execution_id)
        )
          return rejected(
            "NOT_FOUND",
            "Execution does not match the trusted scenario scope.",
          );
        return CopilotRunResultSchema.parse({
          status: outcome.status,
          scenarioId: scenario.id,
          executionId: outcome.runId,
          comparisonId: outcome.comparisonId,
          references: [
            {
              kind: "scenario_execution",
              scenarioId: scenario.id,
              executionId: outcome.runId,
            },
            ...(outcome.comparisonId === null
              ? []
              : [{ kind: "comparison", comparisonId: outcome.comparisonId }]),
          ],
        });
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof z.ZodError)
          return rejected(
            "INVALID_INPUT",
            "Invalid run arguments or scenario data.",
          );
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "not_found"
        )
          return rejected(
            "NOT_FOUND",
            "No such scenario or execution in this project.",
          );
        return rejected(
          "UNAVAILABLE",
          "Scenario execution is unavailable; retry with its scoped execution ID when known.",
        );
      }
    },
  };
}
