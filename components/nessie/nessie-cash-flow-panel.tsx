"use client";

import { useEffect, useId, useState } from "react";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import {
  NessieCashFlowResponseSchema,
  type NessieCashFlowResponse,
} from "@/lib/contracts/nessie";
import {
  projectCashBuffer,
  upfrontCostCents,
  type MonthlyContribution,
} from "@/lib/nessie/projection";

export type NessieProjectionOption = {
  siteId: string;
  label: string;
  monthlyContributionUsd: MonthlyContribution;
};
type LoadState = {
  key: string;
  data: NessieCashFlowResponse | null;
  error: string | null;
};
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" });
const fieldClass = "rounded-lg border border-line bg-white p-2 text-sm";
const buttonClass =
  "rounded-lg border border-line px-3 py-2 text-sm font-semibold text-pine disabled:opacity-50";

export function NessieCashFlowPanel({
  projections,
  outdated = false,
}: {
  projections: NessieProjectionOption[];
  outdated?: boolean;
}) {
  const headingId = useId();
  const [accountId, setAccountId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [upfrontUsd, setUpfrontUsd] = useState("0");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({
    key: "",
    data: null,
    error: null,
  });
  const requestKey = `${attempt}:${accountId}`;
  const loading = state.key !== requestKey;
  const payload = !loading && !state.error ? state.data : null;
  const snapshot =
    payload?.snapshot?.accountId === accountId ? payload.snapshot : null;
  const account = snapshot
    ? payload?.accounts.find((entry) => entry.id === snapshot.accountId)
    : null;
  const selectedProjection = projections.find(
    (entry) => entry.siteId === siteId,
  );

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const query = accountId ? `?${new URLSearchParams({ accountId })}` : "";
    async function load() {
      try {
        const response = await fetch(`/api/integrations/nessie${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            "Nessie could not load this sandbox. Check the Nessie v2 setup, then retry.",
          );
        const data = NessieCashFlowResponseSchema.parse(await response.json());
        if (
          accountId &&
          (data.status !== "ready" || data.snapshot?.accountId !== accountId)
        )
          throw new Error(
            "That account is no longer available. Refresh the sandbox to choose an account.",
          );
        if (!disposed) setState({ key: requestKey, data, error: null });
      } catch (error) {
        if (!disposed)
          setState((previous) => ({
            key: requestKey,
            data: previous.data,
            error: controller.signal.aborted
              ? "Nessie took too long to respond. Refresh and try again."
              : error instanceof Error && !error.name.includes("Zod")
                ? error.message
                : "Nessie returned an unreadable response. Refresh and try again.",
          }));
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [accountId, requestKey]);

  function refresh() {
    // Re-list the sandbox so deleted accounts and their snapshots cannot linger.
    setAccountId("");
    setAttempt((value) => value + 1);
  }

  let projection: ReturnType<typeof projectCashBuffer> | null = null;
  let projectionError: string | null = null;
  if (account && selectedProjection && !outdated) {
    try {
      projection = projectCashBuffer(
        account.availableCents,
        upfrontCostCents(upfrontUsd),
        selectedProjection.monthlyContributionUsd,
      );
    } catch (error) {
      projectionError =
        error instanceof Error ? error.message : "Review the upfront cost.";
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-8 min-w-0 space-y-5 rounded-xl border border-line p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-xl font-semibold">
            Cash buffer
          </h2>
          <p className="mt-1 text-sm text-muted">
            Capital One Nessie · Simulated banking
          </p>
        </div>
        <button type="button" className={buttonClass} onClick={refresh}>
          Refresh sandbox
        </button>
      </div>
      <p className="max-w-prose text-sm text-muted">
        Explore the shared demo sandbox. These accounts are simulated and are
        not connected to your business’s bank.
      </p>
      {loading && (
        <p role="status">
          {accountId ? "Loading account cash flow…" : "Loading Nessie sandbox…"}
        </p>
      )}
      {!loading && state.error && (
        <div role="alert" className="space-y-3">
          <p>{state.error}</p>
          <a
            className="block text-sm text-pine underline"
            href="https://v2.nessieisreal.com/account"
            target="_blank"
            rel="noreferrer"
          >
            Review Nessie v2 setup
          </a>
          <button type="button" onClick={refresh} className={buttonClass}>
            Retry Nessie
          </button>
        </div>
      )}
      {payload && payload.status !== "ready" && (
        <p role="status">{payload.message}</p>
      )}
      {(state.data?.accounts.length ?? 0) > 0 && (
        <label className="grid max-w-md gap-2 text-sm font-medium">
          Simulated cash account
          <select
            className={fieldClass}
            value={accountId}
            disabled={loading}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Choose a checking or savings account</option>
            {state.data?.accounts.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.nickname || entry.id} · {entry.type}
              </option>
            ))}
          </select>
        </label>
      )}
      {payload?.status === "ready" && !accountId && (
        <p className="text-sm text-muted">
          Choose the simulated account to use for this comparison. Credit-card
          borrowing capacity is not counted as cash.
        </p>
      )}
      {snapshot && account && (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Snapshot{" "}
            <time dateTime={snapshot.asOf}>
              {new Date(snapshot.asOf).toLocaleString("en-US", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </time>
            . Cash movements from {date(snapshot.windowStart)} to{" "}
            {date(snapshot.windowEnd)} (30 days).
          </p>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label="Available cash"
              value={money(account.availableCents)}
            />
            <Metric
              label="Cash in · last 30 days"
              value={money(snapshot.inflowCents)}
            />
            <Metric
              label="Cash out · last 30 days"
              value={money(snapshot.outflowCents)}
            />
            <Metric
              label="Net cash movement · last 30 days"
              value={money(snapshot.netCashFlowCents)}
            />
            <Metric
              label="Upcoming bills · next 30 days"
              value={money(snapshot.upcomingBillsCents)}
            />
          </dl>
          <p className="max-w-prose text-sm text-muted">
            Cash movements are not sales or profit.{" "}
            {snapshot.excludedTransfersCount} transfers excluded. Pending
            payment holds are already reflected in available cash; only
            completed cash movements are counted above.
          </p>
          {outdated ? (
            <p role="status">
              Rerun the comparison before projecting cash: its site results are
              outdated or still running.
            </p>
          ) : !projections.length ? (
            <p role="status">
              Run a current site comparison to explore how its modeled
              contribution changes this cash buffer.
            </p>
          ) : (
            <div className="space-y-4 border-t border-line pt-5">
              <h3 className="font-semibold">Cash under a site scenario</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  Site scenario
                  <select
                    className={fieldClass}
                    value={selectedProjection?.siteId ?? ""}
                    onChange={(event) => setSiteId(event.target.value)}
                  >
                    <option value="">Choose a compared site</option>
                    {projections.map((option) => (
                      <option key={option.siteId} value={option.siteId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Upfront cost ($)
                  <input
                    className={fieldClass}
                    type="text"
                    inputMode="decimal"
                    value={upfrontUsd}
                    onChange={(event) => setUpfrontUsd(event.target.value)}
                    aria-invalid={Boolean(projectionError)}
                    aria-describedby={`${headingId}-upfront`}
                  />
                </label>
              </div>
              <p id={`${headingId}-upfront`} className="text-sm text-muted">
                Your assumption, initially $0. Include one-time setup costs
                here; the site contribution already includes its modeled monthly
                operating costs.
              </p>
              {projectionError && <p role="alert">{projectionError}</p>}
              {projection && (
                <div
                  aria-live="polite"
                  className="space-y-3 rounded-lg bg-paper p-4"
                >
                  <p className="font-semibold">
                    Modeled cash after one month:{" "}
                    {money(projection.cashAfterOneMonthCents.mean)}{" "}
                    <EvidenceBadge kind="Simulation" />
                  </p>
                  <p className="text-sm">
                    Scenario range:{" "}
                    {money(projection.cashAfterOneMonthCents.low)} to{" "}
                    {money(projection.cashAfterOneMonthCents.high)}.
                  </p>
                  <p className="text-sm">
                    {projection.coverage.kind === "depleted"
                      ? "The cash buffer is depleted before monthly operations after the entered upfront cost."
                      : projection.coverage.kind === "burning"
                        ? `Cash covers about ${projection.coverage.months.toLocaleString("en-US", { maximumFractionDigits: 1 })} months of the mean modeled operating loss.`
                        : "No monthly operating loss in the mean scenario; a finite cash-coverage period does not apply."}
                  </p>
                  <p className="text-sm text-muted">
                    Recent cash movements and upcoming bills are context only.
                    This calculation uses available cash, your upfront cost, and
                    the site’s modeled operating contribution. This is a
                    scenario, not a forecast.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">
        {value} <EvidenceBadge kind="Simulation" />
      </dd>
    </div>
  );
}
