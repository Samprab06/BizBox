import { z } from "zod";
import type { OriginSchema } from "@/lib/contracts";
import {
  GroundedLocationPlanSchema,
  type GroundedLocationPlan,
  type PlanFact,
  type PlanReference,
} from "@/lib/contracts/plan";
import {
  buildSiteLabels,
  humanizeText,
  metricLabel,
  sourceLabels,
  statusSentence,
  type SiteLabels,
} from "./plan-copy";

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
  /** Short, de-duplicated, human source names ("Your answers", "Public data", ...). */
  sources: string[];
  /** Raw evidence references; technical details only, never shown inline. */
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
  /** The profile changed after this comparison ran; the plan still reflects the run. */
  outdated: boolean;
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

/** Fail closed before rendering: the comparison must be this project's. An outdated one still exports. */
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

export const OUTDATED_LIMITATION =
  "This plan uses your answers as they were when this comparison ran; they've changed since. Rerun the comparison to update these modeled ranges.";

export function referenceLabel(ref: PlanReference): string {
  if ("comparisonId" in ref)
    return `comparison ${ref.comparisonId} · ${ref.metric}`;
  if ("runId" in ref) return `run ${ref.runId} · ${ref.metric}`;
  return `evidence ${ref.evidenceId} · ${ref.metric}`;
}

/** "<address> — <setting>" for assumption paths that name a site; otherwise just the setting. */
function assumptionLabel(path: string, labels: SiteLabels): string {
  const id = Object.keys(labels).find((k) => path.includes(`sites.${k}.`));
  const name = metricLabel(path);
  return id ? `${labels[id]} — ${name}` : name;
}

const number = (v: number) =>
  Math.abs(v) >= 100
    ? Math.round(v).toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A range (never a single forecast figure unless the input itself is a fixed setting). */
export function formatFact(fact: PlanFact): string {
  const { low, high } = fact.range;
  const money = /usd|\$|dollar/i.test(fact.unit);
  const share = /^(fraction|share|ratio)$/i.test(fact.unit.trim());
  const minutes = /^min(ute)?s?$/i.test(fact.unit.trim());
  const fmt = (v: number) =>
    money
      ? `$${number(v)}`
      : share
        ? `${Math.round(v * 100)}%`
        : minutes
          ? (Math.round(v * 10) / 10).toLocaleString("en-US")
          : number(v);
  const unit = money
    ? fact.unit
        .replace(/usd/i, "")
        .replace(/^[_\s]+/, "")
        .replaceAll("_", " ")
    : share
      ? ""
      : minutes
        ? "min"
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
  sources: sourceLabels(fact.origins),
  citations: [
    referenceLabel(fact.reference),
    ...fact.evidenceIds.map((id) => `evidence ${id}`),
  ],
  ...(note ? { note } : {}),
});
/** "<address> — <metric>" for a fact whose reference path starts with `sites.<id>.`. */
const factLabel = (fact: PlanFact, labels: SiteLabels) => {
  const metric = fact.reference.metric;
  const id = Object.keys(labels).find((k) => metric.startsWith(`sites.${k}.`));
  return id ? `${labels[id]} — ${metricLabel(metric)}` : metricLabel(metric);
};

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
  const labels = buildSiteLabels(
    [
      ...new Set([
        ...plan.why.map((w) => w.siteId),
        ...(plan.plan.recommendedSiteId ? [plan.plan.recommendedSiteId] : []),
        ...(plan.runnerUpSiteId ? [plan.runnerUpSiteId] : []),
        ...plan.tiedSiteIds,
      ]),
    ],
    input.siteLabels,
  );
  const site = (id: string | null) => (id ? (labels[id] ?? null) : null);
  const say = (text: string) => humanizeText(text, labels);

  const sections: PrintableSection[] = [
    {
      id: "comparison",
      title: "Why this site",
      notes: [
        ...new Set(
          plan.why.map((w) => `${site(w.siteId)}: ${say(w.explanation)}`),
        ),
      ],
      rows: plan.why.flatMap((w) =>
        w.facts.map((f) =>
          factRow(`${site(w.siteId)} — ${metricLabel(f.reference.metric)}`, f),
        ),
      ),
    },
    {
      id: "conditions",
      title: "Conditions that change the choice",
      notes: [
        ...new Set(plan.plan.conditions.map(say)),
        `Customer demand model: ${plan.demand.actual === "jev" ? "Jev customer panel" : "Huff gravity model"}${plan.demand.requested !== plan.demand.actual ? ` (the ${plan.demand.requested === "jev" ? "Jev customer panel" : "Huff gravity model"} was requested)` : ""}${plan.demand.fallbackReason ? `. ${say(plan.demand.fallbackReason)}` : ""}. Cross-check with the simpler Huff model: ${plan.demand.huffAgreement.replaceAll("_", " ")}.`,
      ],
      rows: plan.sensitivity.flatMap((s) => [
        factRow(
          `${metricLabel(s.assumption)} — range we tested`,
          s.testedRange,
          say(s.conclusion),
        ),
        ...(s.flipBracket
          ? [
              factRow(
                `${metricLabel(s.assumption)} — best site changes between`,
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
      rows: plan.leaseTargets.map((f) => factRow(factLabel(f, labels), f)),
    },
    {
      id: "operations",
      title: "Staffing, stations and buildout",
      notes: [],
      rows: [...plan.staffingAndStations, ...plan.buildoutBudget].map((f) =>
        factRow(factLabel(f, labels), f),
      ),
    },
    {
      id: "first-90-days",
      title: "First 90 days: what to check",
      notes: [],
      rows: plan.firstNinetyDays.map((c) => ({
        label: say(c.check),
        value: "",
        origins: [],
        sources: [],
        citations: c.references.map(referenceLabel),
      })),
    },
    {
      id: "assumptions",
      title: "Assumptions and where they come from",
      notes: [],
      rows: plan.assumptions.map((a) => ({
        label: assumptionLabel(a.path, labels),
        value: a.fact
          ? formatFact(a.fact)
          : a.qualitativeValue === null
            ? "unknown"
            : String(a.qualitativeValue),
        origins: [a.origin],
        sources: sourceLabels([a.origin]),
        citations: [referenceLabel(a.reference)],
        note:
          a.sensitivity.status === "tested"
            ? say(a.sensitivity.conclusion)
            : "Not tested by a sensitivity run.",
      })),
    },
    {
      id: "findings",
      title: "Findings and caveats",
      notes: plan.findings.map((f) =>
        f.siteId ? `${site(f.siteId)}: ${say(f.message)}` : say(f.message),
      ),
      rows: [],
    },
  ];

  return {
    title: "Location plan",
    comparisonId: comparison.comparisonId,
    status: plan.status,
    recommendation: statusSentence(plan.status, {
      recommended: site(plan.plan.recommendedSiteId),
      tied: plan.tiedSiteIds.map((id) => site(id)!),
    }),
    recommendedSite: site(plan.plan.recommendedSiteId),
    runnerUp: site(plan.runnerUpSiteId),
    tied: plan.tiedSiteIds.map((id) => site(id)!),
    sections: sections.filter((s) => s.rows.length || s.notes.length),
    attributions: ATTRIBUTIONS,
    limitations: [
      ...new Set(
        comparison.outdated
          ? [OUTDATED_LIMITATION, ...LIMITATIONS]
          : LIMITATIONS,
      ),
    ],
    outdated: comparison.outdated,
  };
}
