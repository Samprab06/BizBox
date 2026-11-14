import "server-only";
import { randomUUID } from "node:crypto";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createScenarioService } from "@/lib/scenario/service";
import { createScenarioHandlers } from "./handler";
import { createPostgresScenarioRunner } from "@/lib/scenario/runtime";
import { createScenarioRunHandlers } from "./run-handler";
import { createPostgresLayoutRepository, loadLayoutDiffHook } from "@/lib/layout/repository";

// The repository opens no connection until a validated request calls it.
export const scenarioHandlers = createScenarioHandlers(
  createScenarioService({
    repository: createPostgresScenarioRepository(),
    newId: () => `scenario_${randomUUID()}`,
    layoutDiff: (projectId, ids) => loadLayoutDiffHook(createPostgresLayoutRepository(), projectId, ids),
  }),
);

export const scenarioRunHandlers = createScenarioRunHandlers({
  start: (...args) => createPostgresScenarioRunner().start(...args),
  get: (...args) => createPostgresScenarioRunner().get(...args),
  advance: (...args) => createPostgresScenarioRunner().advance(...args),
});
