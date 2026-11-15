import type { BusinessProfile } from "@/lib/contracts";
import type { InteriorFlowState } from "@/lib/client/flow-steps";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import type { InteriorResponse } from "@/lib/contracts/interior";
import { InteriorResponseSchema } from "@/lib/contracts/interior";
import { prepareSpatialDraft } from "@/lib/interior/prepare-spatial";

/** Retrieval timestamps are evidence metadata, not a change to layout/source semantics. */
function sourceFingerprint(source: InteriorResponse | undefined): string {
  return JSON.stringify(source, (key, value) =>
    key === "retrievedAt" || key === "checkedAt" ? undefined : value,
  );
}

/** Apply arriving source data only to an untouched baseline; never overwrite edits. */
export function prepareInteriorFlow(
  current: InteriorFlowState,
  raw: InteriorResponse,
): InteriorFlowState {
  const source = InteriorResponseSchema.parse(raw);
  // Client-permitted SDK keys are live viewer configuration, not report evidence.
  if (source.kind === "scan") delete source.showcaseParams;
  if (sourceFingerprint(current.source) === sourceFingerprint(source)) return current;
  const untouched =
    JSON.stringify(current.baseline) === JSON.stringify(current.draft) &&
    current.ranRevision === null &&
    current.reviewedRevision === null;
  const baseline = untouched
    ? prepareSpatialDraft(current.baseline, source)
    : current.baseline;
  return {
    ...current,
    source,
    baseline,
    draft: untouched ? baseline : (current.draft.room.alignment && (source.kind !== "scan" || current.draft.room.alignment.modelId !== source.modelId)
      ? {...current.draft, room:{...current.draft.room,alignment:undefined}} : current.draft),
    ranRevision: null,
    reviewedRevision: null,
    policies: undefined,
    policyReceipt: undefined,
    finding: undefined,
    affordability: undefined,
    affordabilityAccountId: undefined,
    reference: undefined,
  };
}

/** Real selected identity and intake inputs; room shape and demand remain explicit assumptions. */
export function createInteriorFlow({
  projectId,
  siteId,
  comparisonId,
  profile,
  selectionRationale,
}: {
  projectId: string;
  siteId: string;
  comparisonId: string;
  profile: BusinessProfile;
  selectionRationale?: string;
}): InteriorFlowState {
  if (profile.projectId !== projectId || profile.category === "unsupported")
    throw new Error("A supported business profile is required for this space.");
  const base = createSpatialDraft({
    projectId,
    siteId,
    city: profile.city === "Houston" ? "houston" : "los_angeles",
    category: profile.category,
  });
  const settings = {
    ...base.settings,
    openMin: profile.operatingHours.openMinute,
    closeMin: profile.operatingHours.closeMinute,
    staff: profile.capacity.servers.value ?? base.settings.staff,
    serviceMin:
      profile.capacity.serviceMinutes.value ?? base.settings.serviceMin,
    averageTicketUsd:
      profile.economics.averageTicketCents.value !== null
        ? profile.economics.averageTicketCents.value / 100
        : base.settings.averageTicketUsd,
    wageUsdPerHour:
      profile.derivedDefaults.wageRateCentsPerHour.value !== null
        ? profile.derivedDefaults.wageRateCentsPerHour.value / 100
        : base.settings.wageUsdPerHour,
    cogsFraction:
      profile.derivedDefaults.cogsFraction.value ?? base.settings.cogsFraction,
  };
  const draft = applySpatialCommand(base, { type: "settings", settings });
  return {
    comparisonId,
    siteId,
    ...(selectionRationale?.trim()
      ? { selectionRationale: selectionRationale.trim() }
      : {}),
    baseline: draft,
    draft,
    ranRevision: null,
    reviewedRevision: null,
  };
}

export type InteriorCommandScope = {
  siteId: string;
  comparisonId: string;
  draftId: string;
  expectedRevision: number;
};
export function matchesInteriorScope(
  current: InteriorFlowState | undefined,
  scope: InteriorCommandScope,
): boolean {
  return Boolean(
    current &&
    current.siteId === scope.siteId &&
    current.comparisonId === scope.comparisonId &&
    current.draft.id === scope.draftId &&
    current.draft.revision === scope.expectedRevision,
  );
}
/** A slow report fetch cannot finalize a draft edited or superseded while awaiting it. */
export async function finalizeWhileCurrent<T>(
  snapshot: InteriorFlowState,
  build: () => Promise<T | null>,
  read: () => InteriorFlowState | undefined,
  comparisonId: () => string | undefined,
): Promise<T | null> {
  const fingerprint = JSON.stringify(snapshot);
  const result = await build();
  return comparisonId() === snapshot.comparisonId &&
    JSON.stringify(read()) === fingerprint
    ? result
    : null;
}

export function matchesReferenceReview(
  current: InteriorFlowState["reference"],
  expected: InteriorFlowState["reference"] | null,
): boolean {
  const a = current ?? null,
    b = expected ?? null;
  return a === null || b === null
    ? a === b
    : a.modelId === b.modelId &&
        a.selectedPlan === b.selectedPlan &&
        a.reviewed === b.reviewed;
}
