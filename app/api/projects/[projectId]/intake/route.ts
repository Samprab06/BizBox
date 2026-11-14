import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { createIntakeCapabilitiesHandler } from "./capabilities";
import { createIntakeHandler } from "./handler";
import { createPostgresIntakeUiLookups } from "./ui-lookups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = createIntakeHandler({
  projectExists: async (projectId) => {
    const rows = await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows.length === 1;
  },
  uiLookups: createPostgresIntakeUiLookups(),
});

export const GET = createIntakeCapabilitiesHandler();
