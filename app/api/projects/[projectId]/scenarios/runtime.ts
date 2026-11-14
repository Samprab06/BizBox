import "server-only";
import { randomUUID } from "node:crypto";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createScenarioService } from "@/lib/scenario/service";
import { createScenarioHandlers } from "./handler";

// The repository opens no connection until a validated request calls it.
export const scenarioHandlers = createScenarioHandlers(
  createScenarioService({
    repository: createPostgresScenarioRepository(),
    newId: () => `scenario_${randomUUID()}`,
  }),
);
