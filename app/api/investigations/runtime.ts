import "server-only";
import { createPostgresInvestigationRepository } from "@/lib/agent/jobs-postgres";
import { createPostgresInvestigationTools } from "@/lib/agent/tools-postgres";
import { loadInvestigationPlannerModule } from "@/lib/agent/runtime-loader";
import { createInvestigationPlanFinalizer } from "@/lib/agent/plan-finalizer";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { createInvestigationHandlers } from "./handlers";

// Construct provider/database dependencies only on a real advancement. The
// durable job/milestones remain authoritative across function invocations.
export const investigationHandlers = createInvestigationHandlers({
  repository: createPostgresInvestigationRepository(),
  planner: process.env.OPENAI_API_KEY?.trim()
    ? async (input) => {
        // The agent SDK loads on a real advancement only, so create, read and
        // validation never depend on it (HAC-58).
        const { createConfiguredInvestigationPlanner } =
          await loadInvestigationPlannerModule();
        return createConfiguredInvestigationPlanner(
          createPostgresInvestigationTools(),
          process.env,
          {
            finalizePlan: createInvestigationPlanFinalizer({
              store: createPostgresComparisonStore(),
              profiles: createPostgresProfileStore(),
            }),
          },
        )(input);
      }
    : undefined,
  resumeToolTimeouts: true,
});
