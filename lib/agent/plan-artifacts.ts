import type { InvestigationJob, InvestigationMilestone } from "./jobs";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
const businessTools = new Set([
  "save_profile",
  "search_sites",
  "get_catchment",
  "poll_customers",
  "evaluate_sites",
  "run_sensitivity",
  "get_site_run",
]);

/** Shared read-only selection for both HTTP plans and durable finish handoffs. */
export function investigationPlanArtifacts(
  job: InvestigationJob,
  milestones: InvestigationMilestone[],
) {
  const entries = milestones
    .filter((m) => m.investigationId === job.id && m.attempt === job.attempt)
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({
      ...m,
      summary: record(m.summary),
      output: record(record(m.summary).output),
    }))
    .filter((m) => businessTools.has(m.tool));
  const succeeded = (m: (typeof entries)[number]) =>
    !m.output.missingInput && !m.output.missingProfile;
  const snapshot = entries
    .filter(
      (m) =>
        m.tool === "save_profile" &&
        succeeded(m) &&
        typeof m.output.profileId === "string",
    )
    .at(-1);
  const profileId =
    typeof snapshot?.output.profileId === "string"
      ? snapshot.output.profileId
      : job.profileId;
  const profileVersion = snapshot?.output.profileVersion;
  // Outputs such as sensitivity/run diagnostics omit profileId. Their position
  // after the latest snapshot establishes applicability, never model prose.
  const current = entries.filter(
    (m) =>
      m.seq >= (snapshot?.seq ?? 0) &&
      (m.output.profileId === undefined || m.output.profileId === profileId) &&
      (m.output.projectId === undefined ||
        m.output.projectId === job.projectId),
  );
  const comparisonIds = current
    .filter(
      (m) =>
        m.tool === "evaluate_sites" &&
        succeeded(m) &&
        m.output.profileId === profileId,
    )
    .flatMap((m) =>
      typeof m.output.comparisonId === "string" ? [m.output.comparisonId] : [],
    );
  return {
    profileId,
    profileVersion,
    comparisonIds,
    findings: [
      ...new Set(
        current.flatMap((m) => [
          ...strings(m.summary.toolFindings),
          ...(succeeded(m) ? strings(m.output.findings) : []),
        ]),
      ),
    ],
  };
}
