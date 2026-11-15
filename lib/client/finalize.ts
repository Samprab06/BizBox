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
  onEnriched,
}: {
  projectId: string;
  payload: LiveComparisonPayload | null;
  chosenSiteId: string;
  rationale?: string;
  addresses: Record<string, string>;
  tweaks?: SiteTweakMap;
  fetchPlan?: typeof fetchGroundedPlan;
  /** Optional grounded details arrive after the caller can show the chosen location. */
  onEnriched?: (summary: FinalPlanSummary) => void;
}): Promise<FinalPlanSummary | null> {
  if (
    !payload ||
    !payload.result.sites.some((site) => site.siteId === chosenSiteId)
  )
    return null;
  try {
    const input = {
      projectId,
      comparisonId: payload.comparisonId,
      chosenSiteId,
      rationale: rationale?.trim() ? rationale : MANUAL_RATIONALE,
      result: payload.result,
      addresses,
      tweaks,
      outdated: payload.outdated,
    };
    const summary = buildFinalPlanSummary({ ...input, plan: null });
    // Choosing a location is local. The optional read must never gate navigation.
    if (onEnriched) {
      void Promise.resolve()
        .then(() =>
          fetchPlan(payload.comparisonId, {
            projectId,
            signal: AbortSignal.timeout(8_000),
          }),
        )
        .then((plan) => {
          if (plan)
            onEnriched(
              buildFinalPlanSummary({
                ...input,
                plan,
                now: new Date(summary.finalizedAt),
              }),
            );
        })
        .catch(() => {
          /* Keep the valid comparison-based summary on enrichment failure. */
        });
    }
    return summary;
  } catch {
    return null;
  }
}
