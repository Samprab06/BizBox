import type { GroundedLocationPlan } from "@/lib/contracts/plan";

/**
 * Presentation-layer copy for the printable plan: turns the stored, evidence-bearing plan text
 * (candidate IDs, citation tags, metric paths) into sentences a founder can read. Pure.
 */

export type SiteLabels = Record<string, string>;

/** `[comparison:…]`, `[run:…]` and `[evidence:…]` tags are evidence plumbing, not prose. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[(?:comparison|run|evidence):[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RAW_ID = /\b\d{4,}:\d{4,}\b/g;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces known site IDs with their label, and any leftover raw ID with a neutral phrase. */
export function replaceSiteIds(text: string, labels: SiteLabels): string {
  let out = text;
  const ids = Object.keys(labels).sort((a, b) => b.length - a.length);
  for (const id of ids)
    out = out.replace(new RegExp(escapeRegExp(id), "g"), () => labels[id]!);
  return out.replace(RAW_ID, "another compared site");
}

export function titleCase(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !/^usd$/i.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const PHRASES: [
  RegExp,
  string | ((match: string, ...groups: string[]) => string),
][] = [
  [
    /Scenario intervals overlap; the ranking is not a meaningful separation\./g,
    "The ranges overlap, so these two are effectively tied.",
  ],
  [
    /Compare operating contribution with after-buildout contribution and service-risk intervals; these are scenarios, not sales forecasts\./g,
    "Compare monthly operating contribution with contribution after buildout, and the wait-time ranges. These are modeled estimates, not sales forecasts.",
  ],
  [
    /The baseline winner does not remain top throughout the cited tested range\. Use the adjacent tested flip bracket when available, not an exact interpolated threshold\./g,
    "The best site changes somewhere inside the range we tested. Use the flip range shown below rather than an exact threshold.",
  ],
  [
    /The baseline winner stays top across the cited tested range only; behavior outside that range is not established\./g,
    "The best site stays on top across the range we tested; outside that range we can't say.",
  ],
  [
    /Related ([a-z_]+) sweep only:/g,
    (_m, p) =>
      `Only the related ${titleCase(p).toLowerCase()} test covers this:`,
  ],
];

/** Full cleanup for one displayed sentence. */
export function humanizeText(text: string, labels: SiteLabels): string {
  let out = replaceSiteIds(stripCitations(text), labels);
  for (const [pattern, replacement] of PHRASES)
    out = out.replace(pattern, replacement as string);
  return out
    .replace(/\b(market_share_scale|visit_frequency|ticket_size)\b/g, (m) =>
      titleCase(m).toLowerCase(),
    )
    .replace(/\s+/g, " ")
    .trim();
}

const METRIC_LABELS: Record<string, string> = {
  monthlyContributionUsd: "Monthly operating contribution",
  monthlyContributionAfterBuildoutUsd: "Monthly contribution after buildout",
  monthlyServedCustomers: "Customers per month",
  monthlyRevenueUsd: "Monthly revenue",
  weekdayMeanWaitMin: "Weekday wait",
  weekendMeanWaitMin: "Weekend wait",
  monthlyLeaseUsd: "Monthly rent",
  monthlyBaseRentCents: "Monthly rent",
  rent: "Monthly rent",
  sizeSqft: "Size (sq ft)",
  leaseTermMonths: "Lease term",
  usableStations: "Usable stations",
  planned: "Planned stations",
  headcount: "Staff on shift",
  buildoutUsd: "Buildout cost",
  monthlyRentCeilingCents: "Monthly rent limit",
  buildoutBudgetCents: "Buildout budget",
  startupBudgetCents: "Startup budget",
  horizonDays: "Check-in window",
  market_share_scale: "Market share",
  visit_frequency: "Visit frequency",
  ticket_size: "Ticket size",
  price: "Menu price",
};

/** A plain name for a metric/assumption path such as `sites.<id>.monthlyContributionUsd`. */
export function metricLabel(path: string): string {
  const segments = path.split(".").filter(Boolean);
  const last = segments[segments.length - 1] ?? path;
  return METRIC_LABELS[last] ?? (titleCase(last) || "Estimate");
}

const SOURCE_LABELS: Record<string, string> = {
  founder: "Your answers",
  costar: "Listing data",
  public: "Public data",
  default: "Assumption",
};

export function sourceLabel(origin: string): string {
  return SOURCE_LABELS[origin] ?? "Assumption";
}

/** Short, de-duplicated source labels in a stable order. */
export function sourceLabels(origins: readonly string[]): string[] {
  const order = Object.keys(SOURCE_LABELS);
  return [...new Set(origins)]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(sourceLabel);
}

/**
 * Site ID to label: known addresses win; every other ranked site becomes "Site N" by its
 * position in the ranking, so a raw ID is never shown.
 */
export function buildSiteLabels(
  rankedIds: readonly string[],
  known: SiteLabels = {},
): SiteLabels {
  const out: SiteLabels = {};
  rankedIds.forEach((id, i) => {
    out[id] = known[id]?.trim() || `Site ${i + 1}`;
  });
  return out;
}

/** One plain sentence for the plan's status. */
export function statusSentence(
  status: GroundedLocationPlan["status"],
  names: { recommended: string | null; tied: string[] },
): string {
  switch (status) {
    case "recommended":
      return names.recommended
        ? `Recommended: ${names.recommended}. It's the strongest option within your budget; check the assumptions before you sign.`
        : "One site is the strongest option within your budget; check the assumptions before you sign.";
    case "tie":
      return names.tied.length
        ? `${names.tied.join(" and ")} are effectively tied within your budget. Check the assumptions below before choosing.`
        : "The leading sites are effectively tied within your budget. Check the assumptions below before choosing.";
    case "no_site_meets_budget":
      return "No site fits all of your budget limits. Revise the concept or negotiate the terms, then rerun the comparison.";
    case "budget_unknown":
      return "Your budget isn't set, so this ranking is provisional and isn't a lease recommendation.";
  }
}
