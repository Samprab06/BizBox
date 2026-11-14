import type { InvestigationStepPlanner } from "./jobs";
import { buildLocationPlan } from "./plan";
import { investigationPlanArtifacts } from "./plan-artifacts";
import type { GroundedLocationPlan } from "@/lib/contracts/plan";
import type { ComparisonStore } from "@/lib/evaluation/store";
import type { ProfileStore } from "@/lib/profiles/store";

/** Compose saved artifacts only; no provider calls or persistence side effects. */
export function createInvestigationPlanFinalizer({
  store,
  profiles,
}: {
  store: Pick<ComparisonStore, "load">;
  profiles: Pick<ProfileStore, "load">;
}): (
  input: Parameters<InvestigationStepPlanner>[0],
) => Promise<GroundedLocationPlan | null> {
  return async ({ job, milestones, signal }) => {
    signal.throwIfAborted();
    const artifacts = investigationPlanArtifacts(job, milestones);
    const comparisonId = artifacts.comparisonIds.at(-1);
    if (!comparisonId) return null;
    const comparison = await store.load(job.projectId, comparisonId);
    signal.throwIfAborted();
    if (
      !comparison ||
      comparison.id !== comparisonId ||
      comparison.evaluation.request.projectId !== job.projectId ||
      comparison.evaluation.request.profileId !== artifacts.profileId ||
      (artifacts.profileVersion !== undefined &&
        comparison.evaluation.request.profileVersion !==
          artifacts.profileVersion)
    )
      throw new Error("Invalid investigation plan artifact scope");
    const profile = await profiles.load(job.projectId, artifacts.profileId);
    signal.throwIfAborted();
    if (!profile) throw new Error("Investigation plan profile unavailable");
    return buildLocationPlan({
      projectId: job.projectId,
      comparison,
      profile,
      investigation: { findings: artifacts.findings },
    });
  };
}
