import { makeDemo, demoPlan } from "@/components/simulator/fixture";
/** Recomputed fixed reference experiment, never promoted to selected-property economics. */
export function ReferenceCafeReport({ selectedPlan }: { selectedPlan: 0 | 1 }) {
  const data = makeDemo();
  const money = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  return (
    <section
      aria-label="Reference café counter findings"
      className="space-y-3 rounded-xl border border-current/15 p-4 print:break-inside-avoid"
    >
      <h2 className="text-lg font-semibold">
        Reference interior: Coffee Port counter experiment
      </h2>
      <p>
        Chosen operating example:{" "}
        {selectedPlan === 0 ? "one staffed counter" : "two staffed counters"}.
        The public Coffee Port scan is a visual reference, not a verified scan
        of the selected location.
      </p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>Same 110 generated customers</th>
            <th>One counter</th>
            <th>Two counters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Served by noon</th>
            {data.map((d, i) => (
              <td key={i}>{d.run.metrics.served}</td>
            ))}
          </tr>
          <tr>
            <th>Left without service</th>
            {data.map((d, i) => (
              <td key={i}>{d.run.metrics.abandoned}</td>
            ))}
          </tr>
          <tr>
            <th>Mean completed-customer wait (min)</th>
            {data.map((d, i) => (
              <td key={i}>
                {d.run.metrics.meanWaitMin?.toFixed(1) ?? "Unavailable"}
              </td>
            ))}
          </tr>
          <tr>
            <th>Example monthly contribution</th>
            {data.map((d, i) => (
              <td key={i}>{money(d.monthly.contributionUsd)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="text-sm">
        Additional staffed counter: {money(demoPlan.wage)}/hour and{" "}
        {money(demoPlan.alternativeBuildout - demoPlan.baselineBuildout)} extra
        buildout. Monthly contribution changes by{" "}
        {money(
          data[1].monthly.contributionUsd - data[0].monthly.contributionUsd,
        )}
        , repeating this four-hour weekday 22 times.
      </p>
      <p className="text-xs">
        Authored demand and queue behavior, seed 45; not live Jev or observed
        activity. Interior travel is illustrative. These fixed example economics
        include fixture rent, labor, ingredients and buildout amortization,
        exclude taxes/other overhead, and do not replace the selected location’s
        exterior results.
      </p>
    </section>
  );
}
