import type { NessieConsultantResult } from "@/lib/contracts/nessie";
import { EvidenceBadge } from "@/components/ui/evidence-badge";

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const utcDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" });

/** A saved consultant finding, never a new bank request or editable banking workflow. */
export function ConsultantCashCard({
  result,
}: {
  result: NessieConsultantResult;
}) {
  const { selectedAccount: account, snapshot, scenario } = result;
  return (
    <section
      aria-label="Saved Nessie cash assessment"
      className="mt-3 min-w-0 space-y-3 rounded-lg border border-line bg-paper p-4 text-sm [overflow-wrap:anywhere]"
    >
      <p className="font-semibold">
        Capital One Nessie <EvidenceBadge kind="Simulation" />
      </p>
      <p>
        Shared simulated banking sandbox. These are saved tool results, not a
        connection to your business’s bank.
      </p>
      <p>{result.message}</p>
      {(result.status === "account_selection_required" ||
        result.status === "account_not_found") &&
        result.accounts.length > 0 && (
          <div>
            <p className="font-medium">
              Which demo account should the consultant assess?
            </p>
            <ul
              aria-label="Available demo accounts"
              className="mt-2 list-disc space-y-1 pl-5"
            >
              {result.accounts.map((choice) => (
                <li key={choice.id}>
                  {choice.nickname || choice.id} · {choice.type} · {choice.id}
                </li>
              ))}
            </ul>
          </div>
        )}
      {result.status === "ready" && account && snapshot && (
        <>
          <p className="font-medium">
            Assessed demo account: {account.nickname || account.id} ·{" "}
            {account.type}
          </p>
          <p className="text-xs text-muted">
            Snapshot{" "}
            <time dateTime={snapshot.asOf}>
              {new Date(snapshot.asOf).toLocaleString("en-US", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </time>
            . Cash movement from {utcDate(snapshot.windowStart)} to{" "}
            {utcDate(snapshot.windowEnd)} (30 days).
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Metric label="Available cash" cents={account.availableCents} />
            <Metric
              label="Cash in · last 30 days"
              cents={snapshot.inflowCents}
            />
            <Metric
              label="Cash out · last 30 days"
              cents={snapshot.outflowCents}
            />
            <Metric
              label="Net cash movement · last 30 days"
              cents={snapshot.netCashFlowCents}
            />
            <Metric
              label="Upcoming bills · next 30 days"
              cents={snapshot.upcomingBillsCents}
            />
          </dl>
          <p className="text-xs text-muted">
            Cash movement is not sales or profit.{" "}
            {snapshot.excludedTransfersCount} transfers excluded. Available cash
            already reflects pending payment holds.
          </p>
          {scenario ? (
            <div className="space-y-3 border-t border-line pt-3">
              <p className="font-medium">Assessed site: {scenario.siteId}</p>
              <p className="break-words text-xs text-muted">
                Investigation comparison: {scenario.comparisonId}
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Metric
                  label="Modeled upfront buildout"
                  cents={scenario.modeledUpfrontBuildoutCents}
                />
                <Metric
                  label="Modeled cash after one month · mean"
                  cents={scenario.projection.cashAfterOneMonthCents.mean}
                />
              </dl>
              <p>
                One-month cash interval:{" "}
                {money(scenario.projection.cashAfterOneMonthCents.low)} to{" "}
                {money(scenario.projection.cashAfterOneMonthCents.high)}.
              </p>
              <p>
                {scenario.projection.coverage.kind === "depleted"
                  ? "The modeled upfront buildout depletes this cash buffer before monthly operations."
                  : scenario.projection.coverage.kind === "burning"
                    ? `Cash covers about ${scenario.projection.coverage.months.toLocaleString("en-US", { maximumFractionDigits: 1 })} months of the mean modeled operating loss.`
                    : "No monthly operating loss in the mean scenario; a finite cash-coverage period does not apply."}
              </p>
              <p className="text-xs text-muted">
                Available cash − modeled upfront buildout + modeled monthly
                operating contribution. Recent cash movement and upcoming bills
                are context only. This is a scenario, not a forecast.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Cash evidence only. No site-affordability scenario was assessed in
              this step.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">
        {money(cents)} <EvidenceBadge kind="Simulation" />
      </dd>
    </div>
  );
}
