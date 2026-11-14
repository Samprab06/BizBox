import "server-only";
import { createPostgresInvestigationRepository } from "@/lib/agent/jobs-postgres";
import { createPostgresInvestigationTools } from "@/lib/agent/tools-postgres";
import { createConfiguredInvestigationPlanner } from "@/lib/agent/investigation-planner";
import { createInvestigationHandlers } from "./handlers";

// Construct provider/database dependencies only on a real advancement. The
// durable job/milestones remain authoritative across function invocations.
export const investigationHandlers = createInvestigationHandlers({
  repository: createPostgresInvestigationRepository(),
  planner: process.env.OPENAI_API_KEY?.trim()
    ? (input) =>
        createConfiguredInvestigationPlanner(
          createPostgresInvestigationTools(),
        )(input)
    : undefined,
  resumeToolTimeouts: true,
});
