import "server-only";
import { createPostgresInvestigationRepository } from "@/lib/agent/jobs-postgres";
import { createInvestigationHandlers } from "./handlers";

// HAC-23 injects its server-owned planner here. All state is in Postgres.
export const investigationHandlers = createInvestigationHandlers({
  repository: createPostgresInvestigationRepository(),
});
