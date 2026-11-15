import "server-only";
import {
  InteriorAffordabilityRequestSchema,
  InteriorAffordabilityAssessmentSchema,
  interiorAffordabilityFingerprint,
  type InteriorAffordabilityRequest,
  type InteriorAffordabilityAssessment,
} from "@/lib/contracts/interior-affordability";
import { SiteConfigSchema } from "@/lib/sim/contracts";
import { runSpatialExperiment } from "@/lib/spatial";
import { percentile } from "@/lib/sim/engine";
import { computeMonthlyEconomics } from "@/lib/sim/economics";
import { applyConfigOverrides } from "@/lib/evaluation/evaluate";
import type { StoredComparison } from "@/lib/evaluation/store";
import { projectCashBuffer } from "./projection";
import type { createNessieConsultantReader } from "./consultant";
import type { SpatialDraft } from "@/lib/contracts/spatial";
export class InteriorAffordabilityError extends Error {
  constructor(
    public code: "scope" | "unreviewed" | "unavailable" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
export type InteriorAffordabilityPorts = {
  loadComparison: (
    projectId: string,
    comparisonId: string,
  ) => Promise<StoredComparison | null>;
  currentProfileVersion: (projectId: string) => Promise<number | null>;
  readNessie: ReturnType<typeof createNessieConsultantReader>;
  verifyPolicies?: (
    projectId: string,
    input: InteriorAffordabilityRequest,
  ) => Promise<boolean>;
  assertGeometry?: (draft: SpatialDraft) => Promise<void>;
  now?: () => Date;
};
/** Read-only: trusted stored lease/monthly economics plus a recomputed reviewed spatial run. */
export async function assessInteriorAffordability(
  projectId: string,
  raw: unknown,
  signal: AbortSignal,
  ports: InteriorAffordabilityPorts,
): Promise<InteriorAffordabilityAssessment> {
  signal.throwIfAborted();
  const input = InteriorAffordabilityRequestSchema.parse(raw),
    { baseline, draft } = input;
  if (
    baseline.projectId !== projectId ||
    draft.projectId !== projectId ||
    baseline.siteId !== input.siteId ||
    draft.siteId !== input.siteId ||
    baseline.id !== draft.id ||
    baseline.city !== draft.city ||
    baseline.category !== draft.category
  )
    throw new InteriorAffordabilityError(
      "scope",
      "Interior affordability belongs to another project or selected site",
    );
  if (
    input.ranRevision !== draft.revision ||
    input.reviewedRevision !== draft.revision
  )
    throw new InteriorAffordabilityError(
      "unreviewed",
      "Run and review the current interior before assessing sandbox affordability",
    );
  const comparison = await ports.loadComparison(projectId, input.comparisonId);
  signal.throwIfAborted();
  const request = comparison?.evaluation.request,
    result = comparison?.evaluation.result;
  const sourceSite = request?.sites.find(
      (site) => site.siteId === input.siteId,
    ),
    outcome = result?.sites.find((site) => site.siteId === input.siteId);
  if (
    !comparison ||
    comparison.id !== input.comparisonId ||
    !request ||
    !result ||
    request.projectId !== projectId ||
    result.projectId !== projectId ||
    request.profileId !== result.profileId ||
    request.profileVersion !== result.profileVersion ||
    request.category !== draft.category ||
    request.city !== draft.city ||
    !sourceSite ||
    !outcome ||
    (await ports.currentProfileVersion(projectId)) !== request.profileVersion
  )
    throw new InteriorAffordabilityError(
      "scope",
      "Current owned comparison and selected site are unavailable for affordability",
    );
  const config = applyConfigOverrides(
    SiteConfigSchema.parse(sourceSite.config),
    request.overrides,
  );
  for (const layout of [baseline, draft]) {
    if (layout.room.source === "matterport-bounds") {
      if (!ports.assertGeometry)
        throw new InteriorAffordabilityError(
          "scope",
          "Selected scan geometry cannot be independently verified",
        );
      await ports.assertGeometry(layout);
    }
  }
  if (
    input.policies &&
    (!ports.verifyPolicies || !(await ports.verifyPolicies(projectId, input)))
  )
    throw new InteriorAffordabilityError(
      "scope",
      "Jev policy evidence is invalid, stale or unavailable",
    );
  const experiment = runSpatialExperiment({
    baseline,
    variant: draft,
    policies: input.policies,
  });
  const knownUpfrontBuildoutCents = Math.round(config.lease.buildoutUsd * 100);
  const { low, mean, high } = outcome.monthlyContributionUsd;
  if (
    !Number.isSafeInteger(knownUpfrontBuildoutCents) ||
    knownUpfrontBuildoutCents < 0 ||
    ![low, mean, high].every(Number.isFinite) ||
    low > high
  )
    throw new InteriorAffordabilityError(
      "invalid",
      "Stored modeled buildout or operating contribution is invalid",
    );
  const fingerprint = await interiorAffordabilityFingerprint(projectId, input);
  const nessie = await ports.readNessie({
    investigationId: `interior-assessment-${fingerprint}`,
    attempt: 1,
    projectId,
    profileId: request.profileId,
    profileVersion: request.profileVersion,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    scenario: {
      comparisonId: comparison.id,
      siteId: input.siteId,
      modeledUpfrontBuildoutCents: knownUpfrontBuildoutCents,
      monthlyContributionUsd: { low, mean, high },
    },
    signal,
  });
  signal.throwIfAborted();
  const missingCosts: string[] = [];
  if (draft.items.length)
    missingCosts.push(
      "Proposed furniture purchase, delivery and installation prices are unavailable in the catalog; they are excluded, not valued at zero.",
    );
  if (
    (draft.settings.resourceCapacity ?? 2) >
    (baseline.settings.resourceCapacity ?? 2)
  )
    missingCosts.push(
      "Additional counter/equipment purchase and installation cost is unavailable; the stored buildout does not establish its incremental cost.",
    );
  let proposalProjection: InteriorAffordabilityAssessment["proposalProjection"] =
    null;
  if (
    nessie.status === "ready" &&
    nessie.selectedAccount &&
    config.calendar.weekendDaysPerMonth === 0
  ) {
    const monthly = experiment.variant.runs
      .map(
        (run) =>
          computeMonthlyEconomics(
            {
              ...config,
              hours: {
                ...config.hours,
                weekday: {
                  openMin: draft.settings.openMin,
                  closeMin: draft.settings.closeMin,
                },
              },
              staff: {
                headcount: draft.settings.staff,
                wageUsdPerHour: draft.settings.wageUsdPerHour,
              },
              prices: { avgTicketUsd: draft.settings.averageTicketUsd },
              costs: { cogsPctOfRevenue: draft.settings.cogsFraction },
            },
            {
              weekday: {
                revenueUsd: run.metrics.revenueUsd,
                served: run.metrics.served,
              },
              weekend: { revenueUsd: 0, served: 0 },
            },
          ).operatingContributionUsd,
      )
      .sort((a, b) => a - b);
    const monthlyOperatingContributionUsd = {
      low: percentile(monthly, 0.05)!,
      mean: monthly.reduce((sum, n) => sum + n, 0) / monthly.length,
      high: percentile(monthly, 0.95)!,
    };
    proposalProjection = {
      basis: "reviewed-interior-weekdays-only",
      weekdayDaysPerMonth: config.calendar.weekdayDaysPerMonth,
      monthlyOperatingContributionUsd,
      projection: projectCashBuffer(
        nessie.selectedAccount.availableCents,
        knownUpfrontBuildoutCents,
        monthlyOperatingContributionUsd,
      ),
    };
  }
  const limitations = [
    "Nessie represents shared simulated sandbox funds, not the founder's real bank account, ownership verification or financing approval.",
    "The base cash projection uses the stored exterior monthly operating contribution BEFORE buildout amortization and subtracts the modeled upfront buildout once. Historical transactions and bills are not deducted a second time.",
    "The reviewed interior uses its own synthetic workload. Its operating-day contribution delta is shown separately and is not added to the exterior monthly estimate.",
    "The buildout is a stored modeled amount, not a verified purchase quote; unknown proposal costs prevent a complete affordability or ROI claim.",
    ...(config.calendar.weekendDaysPerMonth > 0
      ? [
          "A proposal monthly cash projection is unavailable because this interior experiment has no separate weekend outcomes for the stored calendar.",
        ]
      : [
          "The separate proposal projection repeats this modeled weekday over the stored weekday calendar, reusing stored rent/opex and the edited staffing/hours/COGS. It is an assumption-based scenario, not a sales forecast.",
        ]),
  ];
  return InteriorAffordabilityAssessmentSchema.parse({
    version: 1,
    fingerprint,
    projectId,
    comparisonId: input.comparisonId,
    siteId: input.siteId,
    draftId: draft.id,
    revision: draft.revision,
    baselineRevision: baseline.revision,
    assessedAt: (ports.now ?? (() => new Date()))().toISOString(),
    source: "nessie",
    synthetic: true,
    status: nessie.status,
    nessie,
    knownUpfrontBuildoutCents,
    missingCosts,
    completeAffordability: false,
    projectionBasis: "stored-exterior-operating-only",
    operatingImpact: {
      period: "modeled-operating-day",
      dailyContributionDeltaUsd: experiment.delta.dailyContributionUsd,
      baselineDailyContributionUsd:
        experiment.baseline.metrics.dailyContributionUsd,
      proposalDailyContributionUsd:
        experiment.variant.metrics.dailyContributionUsd,
      appliedToMonthlyProjection: false,
      behaviorSource: experiment.source,
    },
    proposalProjection,
    limitations,
  });
}
