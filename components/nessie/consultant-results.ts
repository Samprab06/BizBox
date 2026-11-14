import { z } from "zod";
import {
  NessieConsultantResultSchema,
  type NessieConsultantResult,
} from "@/lib/contracts/nessie";

/** Retain saved tool outputs and the identities needed to treat them as evidence. */
export const ConsultantInvestigationResponseSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    profileId: z.string().min(1),
    attempt: z.number().int().positive(),
    status: z.enum(["queued", "running", "succeeded", "failed", "interrupted"]),
    findings: z.array(z.string()).default([]),
    reason: z.string().nullable().optional(),
  }),
  milestones: z.array(
    z.object({
      investigationId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      tool: z.string(),
      attempt: z.number().int().positive(),
      summary: z.unknown().optional(),
    }),
  ),
});
export type ConsultantInvestigation = z.infer<
  typeof ConsultantInvestigationResponseSchema
>;
export type ConsultantScope = {
  investigationId: string;
  projectId: string;
  profile?: { id: string; version: number };
};
export type SelectedNessieResult = {
  seq: number;
  result: NessieConsultantResult;
};
const outputEnvelope = z.object({ output: z.unknown() });
const savedProfile = z.object({
  profileId: z.string().min(1),
  profileVersion: z.number().int().positive(),
});
const evaluatedComparison = z.object({
  comparisonId: z.string().min(1),
  profileId: z.string().min(1),
  siteIds: z.array(z.string().min(1)),
});

export function selectNessieResults(
  raw: unknown,
  scope: ConsultantScope,
): {
  results: SelectedNessieResult[];
  contextChanged: boolean;
} {
  const parsed = ConsultantInvestigationResponseSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.job.id !== scope.investigationId ||
    parsed.data.job.projectId !== scope.projectId
  )
    return { results: [], contextChanged: false };
  const { job } = parsed.data;
  const milestones = parsed.data.milestones
    .filter((m) => m.investigationId === job.id && m.attempt === job.attempt)
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({ ...m, output: outputEnvelope.safeParse(m.summary) }));
  const profiles = milestones
    .filter((m) => m.tool === "save_profile" && m.output.success)
    .map((m) => ({
      seq: m.seq,
      profile: savedProfile.safeParse(
        m.output.success ? m.output.data.output : null,
      ),
    }))
    .filter((entry) => entry.profile.success);
  const latest = profiles.at(-1);
  const profileId = latest?.profile.success
    ? latest.profile.data.profileId
    : job.profileId;
  const profileVersion = latest?.profile.success
    ? latest.profile.data.profileVersion
    : scope.profile?.id === profileId
      ? scope.profile.version
      : undefined;
  if (
    scope.profile &&
    (scope.profile.id !== profileId ||
      (profileVersion !== undefined &&
        scope.profile.version !== profileVersion))
  )
    return { results: [], contextChanged: true };
  let contextChanged = false;
  const results: SelectedNessieResult[] = [];
  // A later limitation or malformed response supersedes older guidance too.
  const newestCashStep = milestones
    .filter((m) => m.tool === "read_nessie_cash_buffer")
    .at(-1);
  for (const milestone of newestCashStep ? [newestCashStep] : []) {
    if (
      milestone.tool !== "read_nessie_cash_buffer" ||
      !milestone.output.success ||
      (latest && milestone.seq <= latest.seq)
    )
      continue;
    if (milestones.filter((entry) => entry.seq === milestone.seq).length !== 1)
      continue;
    const checked = NessieConsultantResultSchema.safeParse(
      milestone.output.data.output,
    );
    if (!checked.success) continue;
    const result = checked.data;
    if (
      result.investigationId !== job.id ||
      result.attempt !== job.attempt ||
      result.projectId !== job.projectId ||
      result.profileId !== profileId
    )
      continue;
    if (
      profileVersion !== undefined &&
      result.profileVersion !== profileVersion
    ) {
      if (scope.profile) contextChanged = true;
      continue;
    }
    if (
      result.scenario &&
      !milestones.some((entry) => {
        if (
          entry.tool !== "evaluate_sites" ||
          entry.seq >= milestone.seq ||
          (latest && entry.seq <= latest.seq) ||
          !entry.output.success
        )
          return false;
        const comparison = evaluatedComparison.safeParse(
          entry.output.data.output,
        );
        return (
          comparison.success &&
          comparison.data.profileId === profileId &&
          comparison.data.comparisonId === result.scenario?.comparisonId &&
          comparison.data.siteIds.includes(result.scenario.siteId)
        );
      })
    )
      continue;
    results.push({ seq: milestone.seq, result });
  }
  return { results, contextChanged };
}
