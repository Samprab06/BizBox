import { z } from "zod";
import type { OriginSchema } from "@/lib/contracts";
import {
  GroundedLocationPlanSchema,
  type GroundedLocationPlan,
  type PlanFact,
  type PlanReference,
} from "@/lib/contracts/plan";

/**
 * HAC-26: printable location plan. A one-way allowlist projection of HAC-24's grounded plan.
 * Nothing from the API payload is spread into the output. Only our own deterministic plan text,
 * cited ranges, origins and reference IDs are exported. Source free text (listing remarks,
 * photos, Matterport, broker contacts) is never included: HAC-14 has not recorded the
 * export terms for it.
 */

export type ExportOrigin = z.infer<typeof OriginSchema>;
export type PrintableRow = {
  label: string;
  value: string;
  origins: ExportOrigin[];
  citations: string[];
  note?: string;
};
export type PrintableSection = {
  id: string;
  title: string;
  notes: string[];
  rows: PrintableRow[];
};
export type PrintablePlan = {
  title: string;
  comparisonId: string;
  status: GroundedLocationPlan["status"];
  recommendation: string;
  recommendedSite: string | null;
  runnerUp: string | null;
  tied: string[];
  sections: PrintableSection[];
  attributions: { label: string; detail: string }[];
  limitations: string[];
};

export class PlanExportRefusal extends Error {
  constructor(
    public readonly code: "outdated" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "PlanExportRefusal";
  }
}

const identity = z.string().min(1).max(300);
const ComparisonSchema = z.object({
  comparisonId: identity,
  outdated: z.boolean(),
  result: z.object({
    projectId: identity,
    profileId: identity,
    profileVersion: z.number().int().positive(),
  }),
});
export type ExportComparison = z.infer<typeof ComparisonSchema>;

/** Fail closed before rendering: the comparison must be this project's and current. */
export function requireCurrentComparison(
  value: unknown,
  projectId: string,
  comparisonId: string,
): ExportComparison {
  const parsed = ComparisonSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.comparisonId !== comparisonId ||
    parsed.data.result.projectId !== projectId
  )
    throw new PlanExportRefusal(
      "invalid",
      "The saved comparison could not be verified.",
    );
  if (parsed.data.outdated)
    throw new PlanExportRefusal(
      "outdated",
      "This comparison is outdated: the profile changed after it ran. Rerun the comparison before exporting.",
    );
  return parsed.data;
}

export const ATTRIBUTIONS: PrintablePlan["attributions"] = [
  {
    label: "CoStar",
    detail:
      "Listing, property and tenancy facts from the CoStar hackathon kit (licensed; cited facts only).",
  },
  {
    label: "U.S. Census Bureau",
    detail:
      "American Community Survey 5-year estimates (block groups) and TIGER/Line geometry.",
  },
  {
    label: "U.S. Census Bureau LEHD",
    detail: "LODES workplace area characteristics (jobs by block).",
  },
  {
    label: "Overture Maps Foundation",
    detail:
      "Places data © OpenStreetMap contributors and other Overture sources.",
  },
];

const LIMITATIONS = [
  "Scenario recommendation, not a sales forecast: every figure is a modelled range under the stated assumptions.",
  "Photos, floor plans, 3D scans and listing remarks are not included until their export terms are confirmed.",
];

export function referenceLabel(ref: PlanReference): string {
  if ("comparisonId" in ref)
    return `comparison ${ref.comparisonId} · ${ref.metric}`;
  if ("runId" in ref) return `run ${ref.runId} · ${ref.metric}`;
  return `evidence ${ref.evidenceId} · ${ref.metric}`;
}

const number = (v: number) =>
  Math.abs(v) >= 100
    ? Math.round(v).toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A range (never a single forecast figure unless the input itself is a fixed setting). */
export function formatFact(fact: PlanFact): string {
  const { low, high } = fact.range;
  const money = /usd|\$|dollar/i.test(fact.unit);
  const fmt = (v: number) => (money ? `$${number(v)}` : number(v));
  const unit = money
    ? fact.unit
        .replace(/usd/i, "")
        .replace(/^[_\s]+/, "")
        .replaceAll("_", " ")
    : fact.unit.replaceAll("_", " ");
  const value = low === high ? fmt(low) : `${fmt(low)} – ${fmt(high)}`;
  const label =
    fact.kind === "input" && low === high
      ? "set"
      : fact.kind === "tested_interval"
        ? "tested"
        : "range";
  return `${value}${unit ? ` ${unit}` : ""} (${label})`;
}

const factRow = (
  label: string,
  fact: PlanFact,
  note?: string,
): PrintableRow => ({
  label,
  value: formatFact(fact),
  origins: [...new Set(fact.origins)],
  citations: [
    referenceLabel(fact.reference),
    ...fact.evidenceIds.map((id) => `evidence ${id}`),
  ],
  ...(note ? { note } : {}),
});
const metricLabel = (fact: PlanFact) =>
  fact.reference.metric.replaceAll(/[._]/g, " ");

export function preparePlanExport(input: {
  projectId: string;
  comparisonId: string;
  comparison: unknown;
  plan: unknown;
  /** Display names for site IDs (e.g. addresses already shown in the app). */
  siteLabels?: Record<string, string>;
}): PrintablePlan {
  const comparison = requireCurrentComparison(
    input.comparison,
    input.projectId,
    input.comparisonId,
  );
  const parsed = GroundedLocationPlanSchema.safeParse(input.plan);
  if (
    !parsed.success ||
    parsed.data.plan.projectId !== input.projectId ||
    parsed.data.plan.comparisonId !== input.comparisonId ||
    parsed.data.plan.profileId !== comparison.result.profileId
  )
    throw new PlanExportRefusal(
      "invalid",
      "The grounded plan does not match this saved comparison.",
    );
  const plan = parsed.data;
  const site = (id: string | null) =>
    id ? (input.siteLabels?.[id] ?? id) : null;

  const sections: PrintableSection[] = [
    {
      id: "comparison",
      title: "Why this site",
      notes: plan.why.map((w) => `${site(w.siteId)}: ${w.explanation}`),
      rows: plan.why.flatMap((w) =>
        w.facts.map((f) => factRow(`${site(w.siteId)} · ${metricLabel(f)}`, f)),
      ),
    },
    {
      id: "conditions",
      title: "Conditions that change the choice",
      notes: [
        ...plan.plan.conditions,
        `Demand model: ${plan.demand.actual === "jev" ? "Jev" : "Huff"}${plan.demand.requested !== plan.demand.actual ? ` (requested ${plan.demand.requested})` : ""}${plan.demand.fallbackReason ? ` · ${plan.demand.fallbackReason}` : ""}. Huff check: ${plan.demand.huffAgreement.replaceAll("_", " ")}.`,
      ],
      rows: plan.sensitivity.flatMap((s) => [
        factRow(
          `${s.assumption.replaceAll("_", " ")} · tested range`,
          s.testedRange,
          s.conclusion,
        ),
        ...(s.flipBracket
          ? [
              factRow(
                `${s.assumption.replaceAll("_", " ")} · flips between`,
                s.flipBracket,
              ),
            ]
          : []),
      ]),
    },
    {
      id: "lease",
      title: "Lease targets",
      notes: [],
      rows: plan.leaseTargets.map((f) => factRow(metricLabel(f), f)),
    },
    {
      id: "operations",
      title: "Staffing, stations and buildout",
      notes: [],
      rows: [...plan.staffingAndStations, ...plan.buildoutBudget].map((f) =>
        factRow(metricLabel(f), f),
      ),
    },
    {
      id: "first-90-days",
      title: "First 90 days: what to check",
      notes: [],
      rows: plan.firstNinetyDays.map((c) => ({
        label: c.check,
        value: "",
        origins: [],
        citations: c.references.map(referenceLabel),
      })),
    },
    {
      id: "assumptions",
      title: "Assumptions and where they come from",
      notes: [],
      rows: plan.assumptions.map((a) => ({
        label: a.path,
        value: a.fact
          ? formatFact(a.fact)
          : a.qualitativeValue === null
            ? "unknown"
            : String(a.qualitativeValue),
        origins: [a.origin],
        citations: [referenceLabel(a.reference)],
        note:
          a.sensitivity.status === "tested"
            ? a.sensitivity.conclusion
            : "Not tested by a sensitivity run.",
      })),
    },
    {
      id: "findings",
      title: "Findings and caveats",
      notes: plan.findings.map((f) =>
        f.siteId ? `${site(f.siteId)}: ${f.message}` : f.message,
      ),
      rows: [],
    },
  ];

  return {
    title: "Location plan",
    comparisonId: comparison.comparisonId,
    status: plan.status,
    recommendation: plan.plan.recommendation,
    recommendedSite: site(plan.plan.recommendedSiteId),
    runnerUp: site(plan.runnerUpSiteId),
    tied: plan.tiedSiteIds.map((id) => site(id)!),
    sections: sections.filter((s) => s.rows.length || s.notes.length),
    attributions: ATTRIBUTIONS,
    limitations: LIMITATIONS,
  };
}
