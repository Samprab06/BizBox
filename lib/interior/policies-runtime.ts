import "server-only";
import { sql } from "drizzle-orm";
import type { SpatialDraft } from "@/lib/contracts/spatial";
import { getDb } from "@/lib/db/client";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createJevClient, DEFAULT_JEV_BASE_URL } from "@/lib/panel/jev-client";
import { spatialScanCalibration } from "./prepare-spatial";
import { createInteriorGetter } from "./runtime";
import {
  InteriorPolicyError,
  prepareInteriorPolicies,
  INTERIOR_JEV_REQUEST_MODEL,
  type InteriorPolicyInput,
  type InteriorPolicyStore,
} from "./policies";
import { createPostgresInteriorPolicyStore } from "./policies-postgres";
import {
  signInteriorPolicyReceipt,
  verifyInteriorPolicyReceipt,
  type InteriorPolicyReceiptInput,
} from "./policies-receipt";
export const INTERIOR_JEV_GRANT_ID = "bizbox-interior-2026-11-15";
let store: InteriorPolicyStore | undefined;
/** Canonical stored geometry only: verification never invokes a provider or writes a cache. */
function scopeValidator() {
  const database = getDb(),
    comparisons = createPostgresComparisonStore(() => database),
    canonical = createInteriorGetter({ allowLicensedAssets: true });
  return async (
    projectId: string,
    comparisonId: string,
    draft: SpatialDraft,
  ) => {
    const comparison = await comparisons.load(projectId, comparisonId),
      request = comparison?.evaluation.request;
    if (
      !comparison ||
      request?.projectId !== projectId ||
      !request.sites.some((s) => s.siteId === draft.siteId)
    )
      throw new InteriorPolicyError(
        "scope",
        "Owned comparison or selected site not found",
      );
    const result = await database.execute(
        sql`SELECT p.city FROM costar_spaces s JOIN costar_properties p ON p.id=s.property_id WHERE s.id=${draft.siteId} LIMIT 1`,
      ),
      city = String(result[0]?.city ?? "")
        .trim()
        .toLowerCase();
    if (city !== (draft.city === "houston" ? "houston" : "los angeles"))
      throw new InteriorPolicyError(
        "scope",
        "Selected site city does not match interior scenario",
      );
    if (
      draft.room.source === "matterport-bounds" &&
      !spatialScanCalibration(await canonical(draft.siteId), draft)
    )
      throw new InteriorPolicyError(
        "scope",
        "Selected scan geometry does not match canonical approved stored source",
      );
  };
}
/** Nothing paid occurs before scoped source validation and a separately initialized durable grant. */
export async function prepareConfiguredInteriorPolicies(
  input: InteriorPolicyInput,
  signal?: AbortSignal,
) {
  const apiKey = process.env.INTERIOR_JEV_API_KEY?.trim();
  if (!apiKey)
    throw new InteriorPolicyError(
      "unavailable",
      "Interior Jev provider is not configured",
    );
  if (
    process.env.JEV_MODEL?.trim() &&
    process.env.JEV_MODEL.trim() !== INTERIOR_JEV_REQUEST_MODEL
  )
    throw new InteriorPolicyError(
      "unsupported",
      "Interior Jev requires the verified jev-latest alias; custom model pricing is not approved",
    );
  store ??= createPostgresInteriorPolicyStore(getDb());
  const prepared = await prepareInteriorPolicies(input, {
    grantId: INTERIOR_JEV_GRANT_ID,
    client: createJevClient({
      baseUrl: DEFAULT_JEV_BASE_URL,
      apiKey,
      modelVersion: INTERIOR_JEV_REQUEST_MODEL,
      concurrency: 1,
      maxRetries: 0,
      maxRateLimitRetries: 0,
      timeoutMs: 6000,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])])
            : init?.signal,
        }),
    }),
    store,
    deadlineAt: Date.now() + 45000,
    cacheEpoch: process.env.INTERIOR_JEV_CACHE_EPOCH?.trim() || undefined,
    signal,
    assertScope: scopeValidator(),
  });
  return {
    ...prepared,
    receipt: signInteriorPolicyReceipt(
      { ...input, policies: prepared.policies },
      apiKey,
    ),
  };
}
/** Read-only provider authenticity/scope check. No monetary reservation or network provider call. */
export async function verifyConfiguredInteriorPolicyReceipt(
  input: InteriorPolicyReceiptInput,
  receipt: unknown,
) {
  const apiKey = process.env.INTERIOR_JEV_API_KEY?.trim();
  if (!apiKey)
    throw new InteriorPolicyError(
      "unavailable",
      "Interior Jev receipt verification is not configured",
    );
  if (!verifyInteriorPolicyReceipt(input, receipt, apiKey))
    throw new InteriorPolicyError(
      "scope",
      "Interior Jev receipt is invalid or stale",
    );
  const assertScope = scopeValidator();
  for (const draft of [input.baseline, input.variant])
    await assertScope(input.projectId, input.comparisonId, draft);
  return { valid: true as const };
}
