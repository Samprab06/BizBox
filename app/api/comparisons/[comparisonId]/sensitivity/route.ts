import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createSensitivityHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A five-value sweep reruns the comparison five times. */
export const maxDuration = 60;
const handler = createSensitivityHandler({ store: createPostgresComparisonStore() });

export async function POST(request: Request, { params }: { params: Promise<{ comparisonId: string }> }) {
  return handler(request, (await params).comparisonId);
}
