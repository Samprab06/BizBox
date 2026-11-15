import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

const scenarioNames = {
  baseline: "Baseline",
  alternative: "Alternative",
} as const;
export type StatProps = Omit<ComponentPropsWithoutRef<"dl">, "children"> & {
  label: string;
  value: ReactNode;
  qualifier?: ReactNode;
  scenario?: keyof typeof scenarioNames;
};

export function Stat({
  label,
  value,
  qualifier,
  scenario,
  className,
  ...props
}: StatProps) {
  return (
    <dl {...props} className={cn("sw-stat text-ink", className)}>
      {scenario && (
        <dt className={`sw-scenario sw-scenario-${scenario}`}>
          {scenarioNames[scenario]}
        </dt>
      )}
      <dt>{label}</dt>
      <dd className="sw-stat-value tabular-nums">{value}</dd>
      {qualifier != null && <dd className="sw-stat-qualifier">{qualifier}</dd>}
    </dl>
  );
}
