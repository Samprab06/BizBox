/**
 * HAC-62: lead with how robust the recommendation is, not with a precise monthly number.
 * Pure: built from the comparison, its sensitivity sweeps, the Huff-only check and assembly
 * findings. Seeded intervals only describe variability under the supplied model, so the
 * headline says which conditions change the answer.
 */
import type {
  EvaluationRequest,
  EvaluationRequestInput,
  EvaluationResult,
  SensitivityAssumption,
  SensitivityResult,
} from "@/lib/contracts/evaluation";
import {
  EvaluationRequestSchema,
  type RobustnessSummary,
} from "@/lib/contracts/evaluation";
import { runSensitivity } from "./evaluate";

export {
  RobustnessSummarySchema,
  type RobustnessSummary,
} from "@/lib/contracts/evaluation";

/** Automatic sweep for the headline. Visit frequency is omitted: it scales demand exactly like market share. */
export const AUTO_SWEEP: Record<
  Exclude<SensitivityAssumption, "visit_frequency" | "price">,
  number[]
> = {
  // 1.0 is omitted: runSensitivity evaluates the baseline itself.
  market_share_scale: [0.5, 0.75, 1.25, 1.5],
  ticket_size: [0.8, 1.2],
  rent: [0.9, 1.1],
};
/** Few seeds keep the sweep near the cost of one full comparison (Vercel maxDuration 60 s). */
export const AUTO_SWEEP_SEEDS = 3;

/** Runs the automatic sweeps (few seeds; deterministic) used for the robustness headline. */
export function autoSensitivities(
  input: EvaluationRequestInput,
): SensitivityResult[] {
  const request = EvaluationRequestSchema.parse(input);
  const seeds = Math.min(request.seeds, AUTO_SWEEP_SEEDS);
  const sweeps = Object.entries(AUTO_SWEEP).map(([assumption, values]) =>
    runSensitivity(request, assumption as SensitivityAssumption, values, {
      seeds,
    }),
  );
  const base = request.sites[0]!.config.prices.avgTicketUsd;
  const prices = [0.85, 1.15].map((m) => Math.round(base * m * 100) / 100);
  sweeps.push(runSensitivity(request, "price", prices, { seeds }));
  return sweeps;
}

const PHRASE: Record<string, string> = {
  market_share_scale: "demand (market share)",
  visit_frequency: "visit frequency",
  ticket_size: "the average ticket",
  rent: "rent",
  price: "the price",
};
const MISSING: Record<string, string> = {
  market_share_scale:
    "Your own sales or visitor counts from another location, to calibrate demand.",
  visit_frequency: "How often your target customers visit similar businesses.",
  ticket_size: "Your expected average ticket.",
  rent: "Negotiated rent for the shortlisted spaces.",
  price: "Your planned price point.",
};
const FINDING_MISSING: Record<string, string> = {
  DEMOGRAPHIC_DEFAULTS:
    "Local age, household and commute detail (some persona demographics are defaults).",
  UNKNOWN_PARKING: "Parking availability for the shortlisted spaces.",
  AREA_PROXY: "Measured usable floor area (marketed area is used as a proxy).",
};

export function robustnessSummary(input: {
  request: EvaluationRequest;
  result: EvaluationResult;
  sensitivities: readonly SensitivityResult[];
  demandSourceCheck?: { topMatches: boolean } | null;
  findings?: readonly { code: string; siteId?: string }[];
  assumptions?: Record<string, { origin: string }>;
  /** Display names for sites (addresses); IDs otherwise. */
  label?: (siteId: string) => string;
}): RobustnessSummary {
  const { request, result } = input;
  const label = input.label ?? ((id: string) => id);
  const leader = result.ranking[0]!;
  const leaderSite = result.sites.find((s) => s.siteId === leader)!;
  const tied = leaderSite.tiedWith;
  const basePrice = request.sites[0]!.config.prices.avgTicketUsd;

  const flips = input.sensitivities
    .filter((s) => s.topChanges && s.breakEven)
    .map((s) => {
      const current = s.unit === "usd" ? basePrice : 1;
      return {
        assumption: s.assumption,
        breakEven: s.breakEven!.value,
        unit: s.unit,
        relativeDistance: Math.abs(s.breakEven!.value - current) / current,
        fromSiteId: s.breakEven!.fromSiteId,
        toSiteId: s.breakEven!.toSiteId,
      };
    })
    .sort(
      (a, b) =>
        a.relativeDistance - b.relativeDistance ||
        a.assumption.localeCompare(b.assumption),
    );
  const most = flips[0] ?? null;
  const robustTo = input.sensitivities
    .filter((s) => !s.topChanges)
    .map((s) => s.assumption);

  const value = (m: NonNullable<typeof most>) =>
    m.unit === "usd"
      ? `$${m.breakEven.toFixed(2)}`
      : `${m.breakEven.toFixed(2)}× its current level`;
  let headline: string;
  if (tied.length)
    headline = `${label(leader)} and ${tied.map(label).join(", ")} are effectively tied under current assumptions: their modelled ranges overlap heavily.`;
  else if (most) {
    // breakEven: fromSiteId leads below the value, toSiteId leads above it.
    const other = most.fromSiteId === leader ? most.toSiteId : most.fromSiteId;
    const direction =
      most.toSiteId === leader
        ? "falls below"
        : most.fromSiteId === leader
          ? "rises above"
          : "crosses";
    headline = `${label(leader)} leads under current assumptions; ${label(other)} leads if ${PHRASE[most.assumption] ?? most.assumption} ${direction} ${value(most)}.`;
  } else
    headline = `${label(leader)} leads across every tested change (${input.sensitivities.map((s) => PHRASE[s.assumption] ?? s.assumption).join(", ")}).`;

  const defaulted = (path: string) =>
    input.assumptions?.[path]?.origin === "default";
  const missing: string[] = [];
  for (const flip of flips) {
    const relevant =
      flip.assumption === "market_share_scale"
        ? result.derivation?.calibration !== "founder"
        : flip.assumption === "ticket_size" || flip.assumption === "price"
          ? defaulted("profile.averageTicketCents") || !input.assumptions
          : true;
    if (relevant && MISSING[flip.assumption])
      missing.push(MISSING[flip.assumption]!);
  }
  for (const f of input.findings ?? []) {
    const text = FINDING_MISSING[f.code];
    if (text && !missing.includes(text)) missing.push(text);
  }
  if (input.demandSourceCheck && !input.demandSourceCheck.topMatches)
    missing.unshift(
      "Customer research to choose between the Jev and Huff demand models, which disagree on the leader.",
    );

  return {
    headline,
    leaderSiteId: leader,
    tiedSiteIds: tied,
    mostInfluential: most,
    robustTo,
    jevHuffAgree: input.demandSourceCheck
      ? input.demandSourceCheck.topMatches
      : null,
    missingInformation: missing.slice(0, 5),
  };
}
