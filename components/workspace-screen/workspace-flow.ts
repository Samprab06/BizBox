/**
 * Scene 1: pure rules for the guided flow inside the workspace (`/workspace?step=`): which
 * step to show, the running comparison's stages, tweak chip wording, the top locations and
 * the stored final-plan summary. The screen (workspace-screen.tsx) wires them to React.
 */
import type { FlowStep } from "@/lib/contracts/agent";
import {
  DEFAULT_SEEDS,
  MAX_COMPARE_UNITS,
  type DemandSource,
  type SiteTweaks,
} from "@/lib/contracts/evaluation";
import {
  FinalPlanSummarySchema,
  type FinalPlanSummary,
} from "@/lib/contracts/plan";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { PanelProgressCount } from "@/lib/panel/progress";

/** The workspace's own steps (the questionnaire is a separate page). */
export type WorkspaceStep = Exclude<FlowStep, "questions">;
const WORKSPACE_STEPS: readonly WorkspaceStep[] = [
  "locations",
  "compare",
  "results",
  "finalize",
];

/**
 * The step to show for a requested one: itself when the founder may open it, otherwise the
 * furthest reachable step before it. `locations` always shows (it explains an unfinished
 * brief itself), so a locked later step never strands the founder.
 */
export function resolveWorkspaceStep(
  requested: FlowStep,
  reachable: readonly FlowStep[],
): WorkspaceStep {
  if (requested === "questions") return "locations";
  const index = WORKSPACE_STEPS.indexOf(requested);
  for (let i = index; i > 0; i--)
    if (reachable.includes(WORKSPACE_STEPS[i])) return WORKSPACE_STEPS[i];
  return "locations";
}

/** The top locations to emphasise: the consultant's picks, else the best-ranked three. */
export function topSiteIds(
  presented: readonly string[] | null,
  candidateIds: readonly string[],
): string[] {
  const picks = (presented ?? []).filter((id) => candidateIds.includes(id));
  return (picks.length ? picks : candidateIds).slice(0, MAX_COMPARE_UNITS);
}

export type StageStatus = "pending" | "active" | "done" | "skipped";
export type ProgressStage = {
  id: "panel" | "simulation" | "economics";
  label: string;
  detail: string;
  status: StageStatus;
  /** 0-1 for the customer panel while Jev personas answer. */
  fraction?: number;
};

/**
 * The running comparison's stages. The server runs them in one request, so the client only
 * knows the Jev panel's persona count; the simulation is shown as in progress once the panel
 * is done (or at once for Huff, which has no panel), and the economics follow it.
 */
export function progressStages(
  demandSource: DemandSource,
  progress: PanelProgressCount | null,
): ProgressStage[] {
  const jev = demandSource === "jev";
  const total = progress?.totalPersonas ?? 0;
  const completed = Math.min(progress?.completedPersonas ?? 0, total);
  const panelDone = jev && total > 0 && completed >= total;
  const panel: ProgressStage = jev
    ? {
        id: "panel",
        label: "Customer panel",
        detail:
          total > 0
            ? `Jev personas answering: ${completed} of ${total}`
            : "Asking Jev personas where they would go",
        status: panelDone ? "done" : "active",
        fraction: total > 0 ? completed / total : 0,
      }
    : {
        id: "panel",
        label: "Customer panel",
        detail: "Not used: Huff estimates demand from distance and attraction",
        status: "skipped",
      };
  const simulating = !jev || panelDone;
  return [
    panel,
    {
      id: "simulation",
      label: "Simulating days",
      detail: `Queue and service simulation across ${DEFAULT_SEEDS} seeded days`,
      status: simulating ? "active" : "pending",
    },
    {
      id: "economics",
      label: "Monthly economics",
      detail: "Customers served, revenue, costs and contribution per month",
      status: "pending",
    },
  ];
}

/** `m:ss` (or `h:mm:ss`) of elapsed time. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const clock = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = String(minute % 60).padStart(2, "0");
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}${m === "00" ? "" : `:${m}`}${suffix}`;
};
const usd = (value: number, cents = false) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents ? 2 : 0,
  });

export type TweakChip = { field: keyof SiteTweaks; label: string };

/** One chip per tweaked field, in a fixed order. */
export function tweakChips(tweaks: SiteTweaks | undefined): TweakChip[] {
  if (!tweaks) return [];
  const chips: TweakChip[] = [];
  if (tweaks.hours)
    chips.push({
      field: "hours",
      label: `Hours ${clock(tweaks.hours.openMinute)}–${clock(tweaks.hours.closeMinute)}`,
    });
  if (tweaks.priceUsd !== undefined)
    chips.push({
      field: "priceUsd",
      label: `Avg ticket ${usd(tweaks.priceUsd, true)}`,
    });
  if (tweaks.staff !== undefined)
    chips.push({
      field: "staff",
      label: `${tweaks.staff} staff on shift`,
    });
  if (tweaks.monthlyRentUsd !== undefined)
    chips.push({
      field: "monthlyRentUsd",
      label: `Rent ${usd(tweaks.monthlyRentUsd)}/mo`,
    });
  return chips;
}

/** The tweaks without one field, or null when none remain. */
export function withoutTweak(
  tweaks: SiteTweaks,
  field: keyof SiteTweaks,
): SiteTweaks | null {
  const next = { ...tweaks };
  delete next[field];
  return Object.keys(next).length ? next : null;
}

const range = (value: { mean: number; low: number; high: number }) => ({
  mean: value.mean,
  low: Math.min(value.low, value.high),
  high: Math.max(value.low, value.high),
});

/**
 * The finalized plan, from the comparison on screen and the consultant's `finalize_plan`.
 * TODO(integrator): Scene 1 workstream F's `lib/client/final-plan.ts` builder (which also
 * reads the comparison's /plan for risks and next steps) should replace this minimal one.
 */
export function minimalFinalPlan({
  projectId,
  payload,
  chosenSiteId,
  rationale,
  addressOf,
  tweaks,
  now = new Date(),
}: {
  projectId: string;
  payload: LiveComparisonPayload;
  chosenSiteId: string;
  rationale: string;
  addressOf: (siteId: string) => string | undefined;
  tweaks?: SiteTweaks;
  now?: Date;
}): FinalPlanSummary | null {
  const sites = payload.result.sites;
  const chosen = sites.find((site) => site.siteId === chosenSiteId);
  if (!chosen) return null;
  const runnerUpId = payload.result.ranking.find((id) => id !== chosenSiteId);
  const runnerUp = sites.find((site) => site.siteId === runnerUpId);
  const summary = {
    projectId,
    comparisonId: payload.comparisonId,
    chosenSiteId,
    chosenAddress: addressOf(chosenSiteId) ?? "Chosen location",
    rationale: rationale.slice(0, 2000),
    finalizedAt: now.toISOString(),
    demandSource: payload.result.demandSource,
    metrics: {
      monthlyServedCustomers: range(chosen.monthlyServedCustomers),
      monthlyContributionUsd: range(chosen.monthlyContributionUsd),
      weekdayMeanWaitMin: range(chosen.weekdayMeanWaitMin),
    },
    ...(tweaks && Object.keys(tweaks).length ? { tweaks } : {}),
    runnerUp: runnerUp
      ? {
          siteId: runnerUp.siteId,
          address: addressOf(runnerUp.siteId) ?? "Runner-up location",
          monthlyContributionUsd: range(runnerUp.monthlyContributionUsd),
        }
      : null,
    risks: (payload.assembly?.findings ?? [])
      .map((finding) => finding.message.slice(0, 500))
      .filter(Boolean)
      .slice(0, 8),
    nextSteps: [
      "Tour the space and confirm the listing facts with the broker.",
      "Negotiate the lease against the modeled monthly contribution.",
      "Recheck the plan with your own costs before signing.",
    ],
  };
  const parsed = FinalPlanSummarySchema.safeParse(summary);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Small per-project memory (localStorage, never required)
// ---------------------------------------------------------------------------

export const greetedKey = (projectId: string) =>
  `bizbox:workspace-greeted:v1:${projectId}`;
export const topSitesKey = (projectId: string) =>
  `bizbox:top-sites:v1:${projectId}`;

export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
export function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* Without storage the greeting may repeat after a reload. */
  }
}
export function readIds(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? value.slice(0, MAX_COMPARE_UNITS)
      : null;
  } catch {
    return null;
  }
}
export function writeIds(key: string, ids: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_COMPARE_UNITS)));
  } catch {
    /* The picks then last only for this visit. */
  }
}
