import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { createProjectsHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createProjectsHandler(async (project) => {
  await getDb().insert(projects).values(project);
});
