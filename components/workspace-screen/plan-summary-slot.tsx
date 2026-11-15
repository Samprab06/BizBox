"use client";

import { useFlowProgress } from "@/lib/client/flow-progress";
import styles from "./workspace-glass.module.css";

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const count = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Scene 1 placeholder for the "Final plan" step.
 * TODO(integrator): replace with workstream F's `<PlanSummary projectId comparisonId />`
 * (components/workspace-screen/plan-summary.tsx); the props are the same. Until then this
 * shows the summary stored in the flow by `finalize_plan`.
 */
export function PlanSummarySlot({
  projectId,
  comparisonId,
}: {
  projectId: string;
  comparisonId: string;
}) {
  const plan = useFlowProgress(projectId).state.finalPlan;
  return (
    <section
      className={styles.unitComparison}
      aria-label="Final plan"
      data-agent-anchor="plan_summary"
    >
      <h2 className="text-2xl font-semibold">Your plan</h2>
      {!plan || plan.comparisonId !== comparisonId ? (
        <p className="mt-3 text-sm">
          Agree on a location with the assistant to finalize your plan.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            <strong>{plan.chosenAddress}</strong>
          </p>
          <p className="mt-2 text-sm">{plan.rationale}</p>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs opacity-75">Est. customers / month</dt>
              <dd>
                {count(plan.metrics.monthlyServedCustomers.mean)}{" "}
                <span className="text-xs opacity-75">
                  ({count(plan.metrics.monthlyServedCustomers.low)}–
                  {count(plan.metrics.monthlyServedCustomers.high)})
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs opacity-75">
                Est. operating contribution / month
              </dt>
              <dd>
                {money(plan.metrics.monthlyContributionUsd.mean)}{" "}
                <span className="text-xs opacity-75">
                  ({money(plan.metrics.monthlyContributionUsd.low)}–
                  {money(plan.metrics.monthlyContributionUsd.high)})
                </span>
              </dd>
            </div>
          </dl>
          {plan.runnerUp && (
            <p className="mt-4 text-xs">
              Runner-up: {plan.runnerUp.address} (
              {money(plan.runnerUp.monthlyContributionUsd.mean)}/mo)
            </p>
          )}
          <h3 className="mt-5 text-sm font-semibold">Next steps</h3>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {plan.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs opacity-75">
            Modeled estimates ·{" "}
            {plan.demandSource === "jev" ? "Jev" : "Huff fallback"}. Not
            measured foot traffic.
          </p>
        </>
      )}
    </section>
  );
}
