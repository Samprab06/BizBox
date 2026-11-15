import { createPostgresViewContextLookups } from "@/lib/agent/view-context-postgres";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { createIntakeCapabilitiesHandler } from "./capabilities";
import { createIntakeHandler } from "./handler";
import { createPostgresIntakeUiLookups } from "./ui-lookups";
import { createPostgresJobsPort } from "@/lib/agent/job-tools-postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = createIntakeHandler({
  viewContextLookups: createPostgresViewContextLookups(),
  projectExists: async (projectId) => {
    const rows = await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows.length === 1;
  },
  uiLookups: createPostgresIntakeUiLookups(),
  jobs: createPostgresJobsPort(),
});

export const GET = createIntakeCapabilitiesHandler();
