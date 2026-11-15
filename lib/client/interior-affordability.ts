import {
  InteriorAffordabilityAssessmentSchema,
  InteriorAffordabilityRequestSchema,
  interiorAffordabilityFingerprint,
  type InteriorAffordabilityRequest,
  type InteriorAffordabilityAssessment,
} from "@/lib/contracts/interior-affordability";
import type { InteriorFlowState } from "./flow-steps";
export function interiorAffordabilityRequest(
  current: InteriorFlowState,
  accountId?: string,
): InteriorAffordabilityRequest {
  return InteriorAffordabilityRequestSchema.parse({
    comparisonId: current.comparisonId,
    siteId: current.siteId,
    baseline: current.baseline,
    draft: current.draft,
    ranRevision: current.ranRevision,
    reviewedRevision: current.reviewedRevision,
    ...(current.policies
      ? { policies: current.policies, policyReceipt: current.policyReceipt }
      : {}),
    ...(accountId ? { accountId } : {}),
  });
}
export async function fetchInteriorAffordability(
  projectId: string,
  input: InteriorAffordabilityRequest,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<InteriorAffordabilityAssessment> {
  const response = await request(
    `/api/projects/${encodeURIComponent(projectId)}/interior-affordability`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok)
    throw new Error(
      "Sandbox affordability could not be assessed. No balance or cost estimate was invented.",
    );
  const result = InteriorAffordabilityAssessmentSchema.parse(
    await response.json(),
  );
  if (
    result.fingerprint !==
    (await interiorAffordabilityFingerprint(projectId, input))
  )
    throw new Error(
      "Sandbox assessment belongs to a different experiment version.",
    );
  return result;
}
