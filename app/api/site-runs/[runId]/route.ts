import { createPostgresSiteRunLoader } from "@/lib/evaluation/site-runs-postgres";
import { createSiteRunReadHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createSiteRunReadHandler(createPostgresSiteRunLoader());

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  return handler(request, (await params).runId);
}
