import { hasReviewedInterior, type InteriorFlowState } from "./flow-steps";
import { buildControlledExperimentFinding } from "@/lib/interior/controlled-experiment";
import { runSpatialExperiment } from "@/lib/spatial";
import { verifyInteriorPolicies } from "./interior-policies";
import {
  fetchInteriorAffordability,
  interiorAffordabilityRequest,
} from "./interior-affordability";
import type { SiteTweakMap } from "@/lib/contracts/evaluation";
import type { FinalPlanSummary } from "@/lib/contracts/plan";
import { buildFinalPlanSummary, fetchGroundedPlan } from "./final-plan";
import type { LiveComparisonPayload } from "./live-comparison";

/** The rationale when the founder picks a location by hand. */
export const MANUAL_RATIONALE = "Chosen from the comparison results.";

/**
 * Builds the final-plan summary for `chosenSiteId` from a finished comparison. The one
 * implementation behind both the consultant's `finalize_plan` action and the "Choose this
 * location" button. Resolves null when the site is not in the comparison or the summary
 * cannot be built; the caller then stores it and opens `finalize`.
 */
export async function finalizeChosenSite({
  projectId,
  payload,
  chosenSiteId,
  rationale,
  addresses,
  tweaks,
  fetchPlan = fetchGroundedPlan,
  interior,
  verifyPolicies = verifyInteriorPolicies,
  fetchAffordability = fetchInteriorAffordability,
}: {
  projectId: string;
  payload: LiveComparisonPayload | null;
  chosenSiteId: string;
  rationale?: string;
  addresses: Record<string, string>;
  tweaks?: SiteTweakMap;
  fetchPlan?: typeof fetchGroundedPlan;
  interior?: InteriorFlowState;
  verifyPolicies?: typeof verifyInteriorPolicies;
  fetchAffordability?: typeof fetchInteriorAffordability;
}): Promise<FinalPlanSummary | null> {
  if (
    !payload ||
    !payload.result.sites.some((site) => site.siteId === chosenSiteId)
  )
    return null;
  if (
    !hasReviewedInterior(interior, {
      projectId,
      siteId: chosenSiteId,
      comparisonId: payload.comparisonId,
    })
  )
    return null;
  const furnitureReviewed =
    interior.ranRevision === interior.draft.revision &&
    interior.reviewedRevision === interior.draft.revision;
  let finding;
  try {
    if (furnitureReviewed) {
      const result = runSpatialExperiment({
        baseline: interior.baseline,
        variant: interior.draft,
        policies: interior.policies,
      });
      if(interior.experimentQuestion) finding=buildControlledExperimentFinding({question:interior.experimentQuestion,baseline:interior.baseline,variant:interior.draft,result});
    }
  } catch {
    return null;
  }
  if (
    interior.policies &&
    (!interior.policyReceipt ||
      !(await verifyPolicies(projectId, {
        comparisonId: interior.comparisonId,
        baseline: interior.baseline,
        variant: interior.draft,
        policies: interior.policies,
        receipt: interior.policyReceipt,
      })))
  )
    return null;
  let affordability = interior.affordability;
  if (affordability) {
    try {
      affordability = await fetchAffordability(
        projectId,
        interiorAffordabilityRequest(interior, interior.affordabilityAccountId),
        AbortSignal.timeout(20000),
      );
    } catch {
      return null;
    }
  }
  // The grounded plan only enriches the summary, so a slow /plan never holds it up.
  const plan = await fetchPlan(payload.comparisonId, {
    projectId,
    signal: AbortSignal.timeout(8_000),
  });
  try {
    const summary = buildFinalPlanSummary({
      projectId,
      comparisonId: payload.comparisonId,
      chosenSiteId,
      rationale: rationale?.trim() ? rationale : MANUAL_RATIONALE,
      result: payload.result,
      addresses,
      tweaks,
      plan,
      outdated: payload.outdated,
    });
    return {
      ...summary,
      ...(furnitureReviewed
        ? {
            interior: {
              comparisonId: interior.comparisonId,
              siteId: interior.siteId,
              ...(interior.source ? { source: interior.source } : {}),
              ...(interior.policies ? { policies: interior.policies } : {}),
              ...(interior.policyReceipt
                ? { policyReceipt: interior.policyReceipt }
                : {}),
              ...(affordability
                ? {
                    affordability,
                    ...(interior.affordabilityAccountId
                      ? {
                          affordabilityAccountId:
                            interior.affordabilityAccountId,
                        }
                      : {}),
                  }
                : {}),
              baseline: interior.baseline,
              draft: interior.draft,
              ...(interior.experimentQuestion ? {experimentQuestion:interior.experimentQuestion} : {}),
              ...(finding ? {finding} : {}),
              ranRevision: interior.draft.revision,
              reviewedRevision: interior.draft.revision,
            },
          }
        : {}),
      ...(!interior.source && interior.reference?.reviewed
        ? {
            referenceCafe: {
              modelId: interior.reference.modelId,
              selectedPlan: interior.reference.selectedPlan,
              reviewed: true as const,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}
