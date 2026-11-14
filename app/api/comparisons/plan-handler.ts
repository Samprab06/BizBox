import { z } from "zod";
import type { buildLocationPlan } from "@/lib/agent/plan";
import type { InvestigationRepository } from "@/lib/agent/jobs";
import { investigationPlanArtifacts } from "@/lib/agent/plan-artifacts";
import type { ComparisonStore } from "@/lib/evaluation/store";
import type { ProfileStore } from "@/lib/profiles/store";
import { invalid, json, notFound, unavailable } from "@/lib/evaluation/http";

const identifier = z.string().trim().min(1).max(200);
const querySchema = z.object({
  projectId: identifier,
  investigationId: identifier.optional(),
});
const invalidPlan = () =>
  invalid(
    "INVALID_PLAN",
    "Provide a valid scoped plan request.",
    new Error("Invalid plan scope or inputs"),
  );

/** Read-only composition: no planner, provider, tool executor or persistence writes. */
export function createComparisonPlanHandler({
  store,
  profiles,
  investigations,
  build,
}: {
  store: Pick<ComparisonStore, "load">;
  profiles: Pick<ProfileStore, "load">;
  investigations?: Pick<InvestigationRepository, "load" | "listMilestones">;
  build: typeof buildLocationPlan;
}) {
  return async function GET(request: Request, comparisonId: string) {
    let query: z.infer<typeof querySchema>;
    try {
      identifier.parse(comparisonId);
      query = querySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
    } catch {
      return invalidPlan();
    }
    try {
      const comparison = await store.load(query.projectId, comparisonId);
      if (
        !comparison ||
        comparison.id !== comparisonId ||
        comparison.evaluation.request.projectId !== query.projectId
      )
        return notFound(
          "COMPARISON_NOT_FOUND",
          "No such comparison in this project.",
        );
      const saved = comparison.evaluation.request;
      let investigation: { findings: string[] } | undefined;
      if (query.investigationId) {
        if (!investigations)
          return unavailable(
            "PLAN_UNAVAILABLE",
            "Investigation artifacts are temporarily unavailable.",
          );
        const job = await investigations.load(query.investigationId);
        if (
          !job ||
          job.id !== query.investigationId ||
          job.projectId !== query.projectId
        )
          return notFound(
            "INVESTIGATION_NOT_FOUND",
            "No such investigation in this project.",
          );
        const artifacts = investigationPlanArtifacts(
          job,
          await investigations.listMilestones(job.id, job.attempt),
        );
        if (
          artifacts.profileId !== saved.profileId ||
          (artifacts.profileVersion !== undefined &&
            artifacts.profileVersion !== saved.profileVersion)
        )
          return invalidPlan();
        if (!artifacts.comparisonIds.includes(comparisonId))
          return invalidPlan();
        investigation = { findings: artifacts.findings };
      }
      const profile = await profiles.load(query.projectId, saved.profileId);
      if (
        !profile ||
        profile.projectId !== query.projectId ||
        profile.id !== saved.profileId
      )
        return notFound(
          "PROFILE_NOT_FOUND",
          "No such profile in this project.",
        );
      if (profile.version !== saved.profileVersion) return invalidPlan();
      try {
        return json(
          build({
            projectId: query.projectId,
            profile,
            comparison,
            ...(investigation ? { investigation } : {}),
          }),
          200,
        );
      } catch {
        // Builder validation errors must never expose stored/private payloads.
        return invalidPlan();
      }
    } catch {
      return unavailable(
        "PLAN_UNAVAILABLE",
        "The location plan could not be loaded. Please try again.",
      );
    }
  };
}
