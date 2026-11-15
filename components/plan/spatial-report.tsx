import { buildControlledExperimentFinding } from "@/lib/interior/controlled-experiment";
import type { FinalPlanSummary } from "@/lib/contracts/plan";
import { runSpatialExperiment } from "@/lib/spatial";
import { InteriorAffordabilityCard } from "@/components/interior/interior-affordability-card";
export function SpatialReport({
  interior,
}: {
  interior: NonNullable<FinalPlanSummary["interior"]>;
}) {
  if (
    interior.ranRevision !== interior.draft.revision ||
    interior.reviewedRevision !== interior.draft.revision
  )
    return (
      <p role="status">
        Interior experiment changed. Run and review it before including results.
      </p>
    );
  let result: ReturnType<typeof runSpatialExperiment> | null = null;
  try {
    result = runSpatialExperiment({
      baseline: interior.baseline,
      variant: interior.draft,
      policies: interior.policies,
    });
  } catch {
    /* Invalid local snapshot is never exported as a result. */
  }
  if (!result)
    return (
      <p role="alert">
        Interior results cannot be verified. Return to the interior stage and
        rerun.
      </p>
    );
  let finding:ReturnType<typeof buildControlledExperimentFinding>|undefined;
  if(interior.experimentQuestion){try{finding=buildControlledExperimentFinding({question:interior.experimentQuestion,baseline:interior.baseline,variant:interior.draft,result});}catch{/* Do not present an uncontrolled edit as one furniture effect. */}}
  const fmt = (n: number | null) =>
    n === null
      ? "Unavailable"
      : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <section
      aria-label="Interior experiment findings"
      className="space-y-3 rounded-xl border border-current/15 p-4 print:break-inside-avoid"
    >
      <h2 className="text-lg font-semibold">Interior experiment</h2>
      {interior.experimentQuestion && <p className="font-medium">{interior.experimentQuestion}</p>}
      {finding && <p className="text-sm">{finding.change.name}: {interior.baseline.items.length} → {interior.draft.items.length}. Same workload, staff, service and pricing.</p>}
      <p className="text-sm">
        {interior.draft.city === "houston" ? "Houston" : "Los Angeles"} ·{" "}
        {interior.draft.category.replaceAll("_", " ")} ·{" "}
        {interior.draft.timezone}
      </p>
      <p className="text-sm">
        {interior.draft.room.source === "matterport-bounds"
          ? "Approximate selected-suite Matterport room bounds."
          : "Modeled layout."}{" "}
        {result.source === "jev"
          ? "Jev-backed customer behavior."
          : "Explicit assumed customer behavior."}{" "}
        Proposed furniture: {interior.baseline.items.length} →{" "}
        {interior.draft.items.length}. Revision {interior.draft.revision},
        reviewed against exterior comparison {interior.comparisonId}.
      </p>
      {interior.policies && (
        <p className="text-sm">
          Behavior evidence: baseline {interior.policies.baseline.modelVersion}{" "}
          · {interior.policies.baseline.evidenceId}; proposal{" "}
          {interior.policies.variant.modelVersion} ·{" "}
          {interior.policies.variant.evidenceId}. Saved policies are replayed
          without new provider calls.
        </p>
      )}
      {interior.source && (
        <p className="text-sm">
          Interior source:{" "}
          {interior.source.kind === "scan"
            ? `Matterport ${interior.source.modelId} (${interior.source.provenance.scope === "space" ? "selected suite" : "building; suite unverified"})`
            : interior.source.kind === "floorplan"
              ? "Listing floor plan"
              : "Modeled fallback"}
          . {interior.source.provenance.description}{" "}
          {interior.source.provenance.limitations.join(" ")}
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Per operating day</th>
            <th>Baseline</th>
            <th>Proposed</th>
            <th>Paired change (p5–p95)</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              "served",
              "abandoned",
              "meanWaitMin",
              "revenueUsd",
              "dailyContributionUsd",
              "routeLengthM",
            ] as const
          ).map((key) => (
            <tr key={key}>
              <th className="text-left font-normal">
                {
                  {
                    served: "Customers served",
                    abandoned: "Customers left",
                    meanWaitMin: "Mean wait (minutes)",
                    revenueUsd: "Revenue ($)",
                    dailyContributionUsd: "Operating contribution ($)",
                    routeLengthM: "Route length (meters)",
                  }[key]
                }
              </th>
              <td className="text-center">
                {fmt(result.baseline.metrics[key].mean)} ({fmt(result.baseline.metrics[key].p5)}–{fmt(result.baseline.metrics[key].p95)})
              </td>
              <td className="text-center">
                {fmt(result.variant.metrics[key].mean)} ({fmt(result.variant.metrics[key].p5)}–{fmt(result.variant.metrics[key].p95)})
              </td>
              <td className="text-center">
                {fmt(result.delta[key].mean)} ({fmt(result.delta[key].p5)}–
                {fmt(result.delta[key].p95)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc pl-5 text-sm">
        {[...new Set([...(finding?.findings ?? result.findings), ...(finding?.limitations ?? result.limitations)])].map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <p className="text-xs">
        Interior operating-day results are a separate assumption-based
        experiment; they do not replace exterior monthly estimates. Furniture
        purchase prices are unavailable; no complete buildout ROI is claimed.
      </p>
      {interior.affordability && (
        <InteriorAffordabilityCard
          assessment={interior.affordability}
          reviewed
        />
      )}
    </section>
  );
}
