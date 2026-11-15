import {
  SpatialPoliciesSchema,
  SpatialPolicyReceiptSchema,
  type SpatialDraft,
  type SpatialPolicies,
  type SpatialPolicyReceipt,
} from "@/lib/contracts/spatial";

/** Preparation is explicit and outside rendering. A failure never returns assumed policies. */
export async function fetchInteriorPolicies(
  projectId: string,
  input: {
    comparisonId: string;
    baseline: SpatialDraft;
    variant: SpatialDraft;
  },
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<{ policies: SpatialPolicies; receipt: SpatialPolicyReceipt }> {
  const response = await request(
    `/api/projects/${encodeURIComponent(projectId)}/interior-policies`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? "Jev preparation is unavailable: server credentials, a writable development policy cache and an authorized budget grant are required. No assumed run was substituted."
        : response.status === 409 || response.status === 429
          ? "Jev preparation could not reserve the authorized budget or the experiment changed. No assumed run was substituted."
          : "Jev preparation failed. No assumed run was substituted.",
    );
  const body: unknown = await response.json();
  return {
    policies: SpatialPoliciesSchema.parse(
      (body as { policies?: unknown })?.policies,
    ),
    receipt: SpatialPolicyReceiptSchema.parse(
      (body as { receipt?: unknown })?.receipt,
    ),
  };
}

/** Rechecks provider authenticity against the server without another paid call. */
export async function verifyInteriorPolicies(
  projectId: string,
  input: {
    comparisonId: string;
    baseline: SpatialDraft;
    variant: SpatialDraft;
    policies: SpatialPolicies;
    receipt: SpatialPolicyReceipt;
  },
  request: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await request(
      `/api/projects/${encodeURIComponent(projectId)}/interior-policies/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(
      body &&
      typeof body === "object" &&
      "valid" in body &&
      body.valid === true,
    );
  } catch {
    return false;
  }
}
