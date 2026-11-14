import { buildLocationPlan } from "@/lib/agent/plan";
import { createPostgresInvestigationRepository } from "@/lib/agent/jobs-postgres";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createPostgresProfileStore } from "@/lib/profiles/store-postgres";
import { createComparisonPlanHandler } from "../../plan-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createComparisonPlanHandler({
  store: createPostgresComparisonStore(),
  profiles: createPostgresProfileStore(),
  investigations: createPostgresInvestigationRepository(),
  build: buildLocationPlan,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ comparisonId: string }> },
) {
  return handler(request, (await params).comparisonId);
}
