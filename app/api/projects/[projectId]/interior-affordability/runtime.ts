import "server-only";
import { createPostgresComparisonStore } from "@/lib/evaluation/store-postgres";
import { createNessieConsultantReader } from "@/lib/nessie/consultant";
import {
  assessInteriorAffordability,
  InteriorAffordabilityError,
} from "@/lib/nessie/interior-assessment";
import { verifyConfiguredInteriorPolicyReceipt } from "@/lib/interior/policies-runtime";
import { createInteriorGetter } from "@/lib/interior/runtime";
import { spatialScanCalibration } from "@/lib/interior/prepare-spatial";

/** Existing canonical sources and Nessie are read-only; no funds, records or accounts are created. */
export async function readConfiguredInteriorAffordability(
  projectId: string,
  raw: unknown,
  signal: AbortSignal,
) {
  const comparisons = createPostgresComparisonStore();
  const canonical = createInteriorGetter({ allowLicensedAssets: true });
  return assessInteriorAffordability(projectId, raw, signal, {
    loadComparison: (project, comparison) =>
      comparisons.load(project, comparison),
    currentProfileVersion: (project) =>
      comparisons.currentProfileVersion(project),
    readNessie: createNessieConsultantReader(),
    verifyPolicies: async (project, input) => {
      if (!input.policies || !input.policyReceipt) return false;
      try {
        await verifyConfiguredInteriorPolicyReceipt(
          {
            projectId: project,
            comparisonId: input.comparisonId,
            baseline: input.baseline,
            variant: input.draft,
            policies: input.policies,
          },
          input.policyReceipt,
        );
        return true;
      } catch {
        return false;
      }
    },
    assertGeometry: async (draft) => {
      signal.throwIfAborted();
      if (!spatialScanCalibration(await canonical(draft.siteId), draft))
        throw new InteriorAffordabilityError(
          "scope",
          "Selected scan geometry no longer matches its approved stored source",
        );
    },
  });
}
