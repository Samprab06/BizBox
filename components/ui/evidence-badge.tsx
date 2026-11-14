import type { ComponentPropsWithoutRef } from "react";
import type { EvidenceKind } from "@/lib/ui/evidence";

const badgeClasses = {
  "Source-backed": "source",
  "Your input": "input",
  Assumption: "assumption",
  Simulation: "simulation",
} as const satisfies Record<EvidenceKind, string>;

export type EvidenceBadgeProps = Omit<
  ComponentPropsWithoutRef<"span">,
  "children"
> & {
  kind: EvidenceKind;
};

/** Keep beside the value it qualifies. The visible text carries the meaning. */
export function EvidenceBadge({
  kind,
  className = "",
  ...props
}: EvidenceBadgeProps) {
  return (
    <span
      {...props}
      className={`sw-evidence sw-evidence-${badgeClasses[kind]} ${className}`}
    >
      {kind}
    </span>
  );
}
