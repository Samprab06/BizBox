export type MonthlyContribution = { low: number; mean: number; high: number };
export type CashProjection = {
  cashAfterOneMonthCents: { low: number; mean: number; high: number };
  coverage:
    | { kind: "depleted"; months: 0 }
    | { kind: "burning"; months: number }
    | { kind: "no_loss"; months: null };
};

function safeCents(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new Error("Cash amount is outside the supported range.");
  return value;
}

/** Owner-entered USD, at most two decimal places; never silently round an input. */
export function upfrontCostCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a nonnegative dollar amount with at most two decimal places.",
    );
  const [whole, fractional = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Upfront cost is too large.");
  return Number(cents);
}

/** Uses modeled operating contribution once, without adding historical flow or bills again. */
export function projectCashBuffer(
  availableCents: number,
  upfrontCents: number,
  monthlyContributionUsd: MonthlyContribution,
): CashProjection {
  safeCents(availableCents);
  safeCents(upfrontCents);
  if (upfrontCents < 0) throw new Error("Upfront cost must be nonnegative.");
  const { low, mean, high } = monthlyContributionUsd;
  // low/high are percentiles, so a skewed arithmetic mean may lie outside them.
  if (![low, mean, high].every(Number.isFinite) || low > high)
    throw new Error("The modeled contribution range is invalid.");
  const afterUpfront = safeCents(availableCents - upfrontCents);
  const monthly = {
    low: safeCents(Math.round(low * 100)),
    mean: safeCents(Math.round(mean * 100)),
    high: safeCents(Math.round(high * 100)),
  };
  const coverageMonths = mean < 0 ? afterUpfront / (-mean * 100) : null;
  if (coverageMonths !== null && !Number.isFinite(coverageMonths))
    throw new Error("The modeled coverage is outside the supported range.");
  return {
    cashAfterOneMonthCents: {
      low: safeCents(afterUpfront + monthly.low),
      mean: safeCents(afterUpfront + monthly.mean),
      high: safeCents(afterUpfront + monthly.high),
    },
    coverage:
      afterUpfront <= 0
        ? { kind: "depleted", months: 0 }
        : coverageMonths !== null
          ? { kind: "burning", months: coverageMonths }
          : { kind: "no_loss", months: null },
  };
}
