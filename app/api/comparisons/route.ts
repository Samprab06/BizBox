import { randomUUID } from "node:crypto";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createComparisonsHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 8 sites x 30 seeds x 2 day types plus the Huff check fit well inside this. */
export const maxDuration = 60;
export const POST = createComparisonsHandler({
  store: createPostgresComparisonStore(),
  newId: () => `cmp_${randomUUID()}`,
});
