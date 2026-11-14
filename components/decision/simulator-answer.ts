import type { RobustnessSummary } from "@/lib/contracts/evaluation";

/** Presentation only: preserves stored conditions and qualifies a single-seed example. */
export function simulatorAnswer({
  example,
  additionalServed,
  contributionChange,
  robustness,
}: {
  example: boolean;
  additionalServed: number;
  contributionChange: number;
  robustness?: RobustnessSummary | null;
}) {
  if (!example)
    return (
      robustness?.headline ??
      "Recommendation robustness is unavailable for this saved comparison."
    );
  const service =
    additionalServed === 0
      ? "serves the same number of modeled customers"
      : additionalServed > 0
        ? `serves ${additionalServed} more modeled customers per weekday`
        : `serves ${Math.abs(additionalServed)} fewer modeled customers per weekday`;
  const contribution =
    contributionChange > 0
      ? "higher"
      : contributionChange < 0
        ? "lower"
        : "unchanged";
  return `In this seeded example, a second staffed station ${service}; contribution after included costs is ${contribution}.`;
}
