import { ConsultantCashCard } from "@/components/nessie/consultant-cash-card";
import type { InteriorAffordabilityAssessment } from "@/lib/contracts/interior-affordability";
import styles from "@/components/workspace-screen/workspace-glass.module.css";
const dollars = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export function InteriorAffordabilityCard({
  assessment,
  preparing = false,
  error,
  reviewed,
  onCheck,
}: {
  assessment?: InteriorAffordabilityAssessment | null;
  preparing?: boolean;
  error?: string | null;
  reviewed: boolean;
  onCheck?: () => void;
}) {
  return (
    <section
      aria-label="Sandbox interior affordability"
      className="my-4 rounded-xl border border-glass-edge p-4 text-sm"
    >
      <h3 className="font-medium">Sandbox affordability</h3>
      <p className="my-2 text-xs text-muted">
        Capital One Nessie is a simulated banking sandbox, not your real bank.
        This read-only check does not move money. Furniture prices and other
        startup costs remain unknown; this is an incomplete affordability
        assessment.
      </p>
      {onCheck && (
        <button
          className={styles.secondary}
          disabled={!reviewed || preparing || !onCheck}
          onClick={onCheck}
        >
          {preparing
            ? "Checking sandbox affordability…"
            : "Check sandbox affordability"}
        </button>
      )}
      {!reviewed && (
        <p className="mt-2 text-xs">
          Review the current interior run before checking its sandbox
          affordability.
        </p>
      )}
      {error && (
        <p role="status" className="mt-2">
          {error}
        </p>
      )}
      {reviewed && assessment && (
        <>
          <ConsultantCashCard result={assessment.nessie} />
          <p className="mt-3">
            Known upfront buildout:{" "}
            {dollars(assessment.knownUpfrontBuildoutCents / 100)}.
          </p>
          <p className="mt-2">
            Interior operating contribution change per modeled operating day:{" "}
            {dollars(assessment.operatingImpact.dailyContributionDeltaUsd.mean)}{" "}
            ({dollars(assessment.operatingImpact.dailyContributionDeltaUsd.p5)}{" "}
            to{" "}
            {dollars(assessment.operatingImpact.dailyContributionDeltaUsd.p95)}
            ). Behavior: {assessment.operatingImpact.behaviorSource}.
          </p>
          <p className="mt-2 text-xs text-muted">
            The stored exterior cash projection remains separate. The daily
            interior change is not added to that monthly projection.
          </p>
          {assessment.proposalProjection && (
            <p className="mt-2">
              Separate reviewed-interior weekday scenario:{" "}
              {assessment.proposalProjection.weekdayDaysPerMonth} operating
              days/month; monthly operating contribution{" "}
              {dollars(
                assessment.proposalProjection.monthlyOperatingContributionUsd
                  .mean,
              )}{" "}
              (
              {dollars(
                assessment.proposalProjection.monthlyOperatingContributionUsd
                  .low,
              )}{" "}
              to{" "}
              {dollars(
                assessment.proposalProjection.monthlyOperatingContributionUsd
                  .high,
              )}
              ). Cash after one month:{" "}
              {dollars(
                assessment.proposalProjection.projection.cashAfterOneMonthCents
                  .mean / 100,
              )}
              .
            </p>
          )}
          <p className="mt-3 font-medium">Unknown or excluded costs</p>
          <ul className="ml-5 list-disc">
            {assessment.missingCosts.map((cost) => (
              <li key={cost}>{cost}</li>
            ))}
          </ul>
          <ul className="mt-2 ml-5 list-disc text-xs text-muted">
            {assessment.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
