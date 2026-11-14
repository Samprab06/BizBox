import type { StationExperimentCallout } from "@/lib/contracts/station-experiment";
import type { MetricSummary } from "@/lib/contracts/evaluation";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { evidenceFor } from "@/lib/ui/evidence";
import { money, number, muted } from "./insights-frame";

export type StationCalloutDays = Readonly<
  Record<"weekday" | "weekend", StationExperimentCallout | null>
>;
export function stationTime(minute: number) {
  const hour = Math.floor(minute / 60),
    min = minute % 60;
  return `${hour % 12 || 12}${min ? ":" + String(min).padStart(2, "0") : ""}${hour >= 12 && hour < 24 ? "pm" : "am"}`;
}
export function StationRange({
  value,
  currency = false,
}: {
  value: MetricSummary;
  currency?: boolean;
}) {
  const format = currency ? money : number;
  return (
    <>
      <data value={String(value.mean)}>{format(value.mean)}</data> mean ·{" "}
      {format(value.low)} to {format(value.high)} p5–p95
    </>
  );
}
export function StationCallout({
  value,
  sourceLabel,
}: {
  value: StationExperimentCallout;
  sourceLabel: string;
}) {
  const change = value.change;
  return (
    <section
      aria-label="Station recommendation"
      className="min-w-0 space-y-3 text-sm"
    >
      <h4 className="text-base font-semibold">
        Highest added revenue among tested station options
      </h4>
      <p className={"break-words " + muted}>
        {sourceLabel} · {value.source.seedCount} paired seeds
      </p>
      <p>
        <EvidenceBadge kind="Simulation" /> {value.label}:{" "}
        <strong>
          <StationRange value={value.monthlyRevenueChangeUsd} currency />
        </strong>
      </p>
      <p
        className={
          value.monthlyContributionChangeUsd.mean < 0
            ? "font-semibold text-[var(--sw-assumption-ink)]"
            : ""
        }
      >
        {value.monthlyContributionChangeUsd.mean < 0
          ? "Contribution decreases after included costs: "
          : "Monthly contribution change after included costs: "}
        <StationRange value={value.monthlyContributionChangeUsd} currency />
      </p>
      <p>
        Planned stations {change.fromPlannedStations} →{" "}
        {change.toPlannedStations}; effective stations{" "}
        {change.fromEffectiveStations} → {change.toEffectiveStations}. Staff{" "}
        {change.fromStaffHeadcount} → {change.toStaffHeadcount}.
      </p>
      <p>
        Whole operating days: weekday{" "}
        {stationTime(change.hours.weekday.openMin)}–
        {stationTime(change.hours.weekday.closeMin)}; weekend{" "}
        {stationTime(change.hours.weekend.openMin)}–
        {stationTime(change.hours.weekend.closeMin)}. No hourly staffing window
        is modeled.
      </p>
      <p>
        {number(value.addedStationHoursPerMonth)} added station-hours/month
        (capacity proxy). Staff-hours: {number(value.addedStaffHoursPerMonth)}{" "}
        added/month; separate from station capacity.
      </p>
      <p className={muted}>
        Recorded input origins:{" "}
        {value.origins.map((origin) => (
          <span key={origin} className="mr-2 inline-block">
            {origin} <EvidenceBadge kind={evidenceFor(origin)} />
          </span>
        ))}
      </p>
      <p className={muted}>
        {value.caption}. Empirical paired-seed ranges, not a confidence
        interval. This choice maximizes modeled added revenue, then uses fewer
        added station-hours; it does not establish the cheapest equipment or
        highest profit.
      </p>
      <details className="min-w-0">
        <summary className="cursor-pointer rounded font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sw-baseline)]">
          Station experiment evidence and limitations
        </summary>
        <p className={"mt-3 " + muted}>
          Monthly net walk-away change (alternative minus baseline):{" "}
          <StationRange value={value.monthlyWalkAwayChange} />.{" "}
          {value.dayType === "weekday" ? "Weekday" : "Weekend"} walk-away
          change: <StationRange value={value.selectedDayWalkAwayChange} />.
          These count balked and reneged customers; added revenue also includes
          other completed services.
        </p>
        <p className={"mt-2 break-words " + muted}>
          Paired seeds: {value.source.seeds.join(", ")}
        </p>
        <ul className={"mt-2 list-disc space-y-1 pl-5 " + muted}>
          {value.limitations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
