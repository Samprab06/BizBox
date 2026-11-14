import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createComparisonReadHandler } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = createComparisonReadHandler({ store: createPostgresComparisonStore() });

export async function GET(request: Request, { params }: { params: Promise<{ comparisonId: string }> }) {
  return handler(request, (await params).comparisonId);
}
