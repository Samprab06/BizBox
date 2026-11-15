import type { StationExperimentConfigurationId } from "@/lib/contracts/station-experiment-run";

/** Plain-language copy and formatting for the founder-facing counters panel. */

export const FOUNDER_INTRO =
  "See how adding a counter (and the person to run it) changes monthly contribution, revenue and customers lost to long lines. Modeled estimates.";

export function founderSourceLine(demandSource: "huff" | "jev"): string {
  return `Based on your latest comparison · ${demandSource === "jev" ? "Jev customer panel" : "Huff estimate"}`;
}

export function counterWord(count: number): string {
  return count === 1 ? "1 counter" : `${count} counters`;
}

/** "Today: 2 counters", "+1 counter (3)", "+2 counters (4)". */
export function founderOptionTitle(
  id: StationExperimentConfigurationId,
  effectiveStations: number,
  baselineStations: number,
): string {
  if (id === "baseline") return `Today: ${counterWord(effectiveStations)}`;
  const added = Math.max(0, effectiveStations - baselineStations);
  return `+${counterWord(added)} (${effectiveStations})`;
}

export function staffLine(headcount: number): string {
  return `${headcount} staff on shift`;
}

export type FounderBadge = {
  label: string;
  tone: "warn" | "info";
} | null;

export function founderStatusBadge(
  status: "planned" | "queued" | "running" | "succeeded" | "failed",
  needsConfirmation = false,
): FounderBadge {
  if (needsConfirmation) return { label: "Needs confirmation", tone: "warn" };
  switch (status) {
    case "queued":
      return { label: "Waiting", tone: "info" };
    case "running":
      return { label: "Running…", tone: "info" };
    case "failed":
      return { label: "Couldn't run", tone: "warn" };
    default:
      return null;
  }
}

export function progressLine(done: number, total: number): string {
  return `${done} of ${total} setups done`;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const rounded = (value: number) => Math.round(Math.abs(value));
const sign = (value: number) => (Math.round(value) < 0 ? "−" : "+");

/** "+$1,800/mo" or "−$300/mo". */
export function signedMoneyPerMonth(value: number): string {
  return `${sign(value)}${USD.format(rounded(value))}/mo`;
}

/** "+120 customers", "−6 min wait" style signed amounts. */
export function signedAmount(value: number, unit: string): string {
  return `${sign(value)}${rounded(value).toLocaleString("en-US")} ${unit}`;
}

export function moneyRange(low: number, high: number): string {
  const f = (v: number) =>
    `${Math.round(v) < 0 ? "−" : ""}${USD.format(rounded(v))}`;
  return `${f(low)} to ${f(high)}`;
}

export function amountRange(low: number, high: number): string {
  const f = (v: number) =>
    `${Math.round(v) < 0 ? "−" : ""}${rounded(v).toLocaleString("en-US")}`;
  return `${f(low)} to ${f(high)}`;
}

type Hours = { openMin: number; closeMin: number };
function clock(minute: number): string {
  const hour = Math.floor(minute / 60),
    min = minute % 60;
  return `${hour % 12 || 12}${min ? ":" + String(min).padStart(2, "0") : ""}${hour >= 12 && hour < 24 ? "pm" : "am"}`;
}
function span(hours: Hours): string {
  return `${clock(hours.openMin)}–${clock(hours.closeMin)}`;
}

/** One line of opening hours, shown once per panel. */
export function hoursLine(hours: { weekday: Hours; weekend: Hours }): string {
  const a = span(hours.weekday),
    b = span(hours.weekend);
  return a === b
    ? `Open ${a} every day.`
    : `Open ${a} on weekdays, ${b} on weekends.`;
}

/** Plain recommendation sentence; never includes ids or seed counts. */
export function founderRecommendation(
  selected: {
    toEffectiveStations: number;
    fromEffectiveStations: number;
    contributionMean: number;
  } | null,
): string {
  if (!selected)
    return "Adding counters doesn't pay off here: today's setup does best (modeled).";
  const added = selected.toEffectiveStations - selected.fromEffectiveStations;
  const gain = USD.format(rounded(selected.contributionMean));
  const verb = selected.contributionMean < 0 ? "costs" : "adds about";
  return `Best option: +${counterWord(added)}. It ${verb} ${gain} a month in contribution (modeled).`;
}
