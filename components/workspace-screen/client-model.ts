import type { SiteSearchResult } from "@/lib/contracts/sites";
import {
  payloadMatches,
  type LiveComparisonPayload,
} from "@/lib/client/live-comparison";
import type { InteriorResponse } from "@/lib/contracts/interior";
import { metricText } from "./model";
import { MAX_COMPARE_UNITS } from "@/lib/contracts/evaluation";
import {
  groupListingMarkers,
  validListingCoordinates,
} from "@/components/city/listing-markers";

export type WorkspaceCandidate = SiteSearchResult["candidates"][number];
export function unitLabel(
  entry: WorkspaceCandidate,
  candidates: readonly WorkspaceCandidate[],
) {
  const units = candidates
    .filter((candidate) => candidate.propertyId === entry.propertyId)
    .sort((a, b) =>
      a.candidate.id.localeCompare(b.candidate.id, "en", { numeric: true }),
    );
  return `Unit ${
    Math.max(
      0,
      units.findIndex(
        (candidate) => candidate.candidate.id === entry.candidate.id,
      ),
    ) + 1
  }`;
}
export function toggleComparisonUnit(
  ids: readonly string[],
  id: string,
): string[] {
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return ids.length >= MAX_COMPARE_UNITS ? [...ids] : [...ids, id];
}
export function unitAddress(
  entry: WorkspaceCandidate,
  candidates: readonly WorkspaceCandidate[],
) {
  return `${entry.candidate.address} · ${unitLabel(entry, candidates)}`;
}

export function realCandidates(candidates: readonly WorkspaceCandidate[]) {
  return candidates.filter(({ candidate }) => !candidate.synthetic);
}

export function candidateCoordinates(entry: WorkspaceCandidate | undefined) {
  const latitude = entry?.candidate.latitude.value;
  const longitude = entry?.candidate.longitude.value;
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    validListingCoordinates(longitude, latitude)
    ? { latitude, longitude }
    : null;
}

export function candidateMarkers(candidates: readonly WorkspaceCandidate[]) {
  return groupListingMarkers(
    realCandidates(candidates).map((entry) => ({
      siteId: entry.candidate.id,
      propertyId: entry.propertyId,
      address: entry.candidate.address,
      longitude: entry.candidate.longitude.value,
      latitude: entry.candidate.latitude.value,
    })),
  );
}

/**
 * A previous comparison must never masquerade as the newly selected locations. Scene 1: nor
 * as a run with other per-site tweaks (`tweaksKey`, from `siteTweaksKey`; "" for none).
 */
export function comparisonMatchesSelection(
  payload: LiveComparisonPayload | null,
  ids: readonly string[],
  tweaksKey = "",
) {
  return payload ? payloadMatches(payload, ids, tweaksKey) : false;
}

/** Why the finished comparison on screen is not for the current choices, or null when it is. */
export type Staleness = "answers" | "selection" | null;

/** The latest finished (non-synthetic) comparison, whatever the current selection. */
export function finishedComparison(
  payload: LiveComparisonPayload | null,
): LiveComparisonPayload | null {
  return payload?.comparison?.synthetic === false ? payload : null;
}

export function comparisonStaleness(
  payload: LiveComparisonPayload | null,
  ids: readonly string[],
  tweaksKey = "",
): Staleness {
  const finished = finishedComparison(payload);
  if (!finished) return null;
  if (finished.outdated) return "answers";
  return payloadMatches(finished, ids, tweaksKey) ? null : "selection";
}

/** What the founder sees after a run that does not match the current choices. */
export function staleMessage(staleness: Staleness): string {
  return staleness === "answers"
    ? "Your answers changed during the run. Rerun to update."
    : staleness === "selection"
      ? "You changed the selection or settings since this run."
      : "";
}

const NOT_MODELED_REASONS: Record<string, string> = {
  SITE_INPUT_UNKNOWN: "the listing is missing size, rent or location details",
  INSUFFICIENT_AREA: "the space is too small for your setup",
  CANDIDATE_UNAVAILABLE: "the listing is no longer available",
};

export type NotModeledUnit = { id: string; address: string; reason: string };

/** Requested units the server could not model, each with a plain reason. */
export function notModeledUnits(
  payload: LiveComparisonPayload,
  candidates: readonly WorkspaceCandidate[],
): NotModeledUnit[] {
  const modeled = new Set(payload.result.sites.map((site) => site.siteId));
  return (payload.requestedIds ?? [])
    .filter((id) => !modeled.has(id))
    .map((id) => {
      const entry = candidates.find((value) => value.candidate.id === id);
      const code = (payload.assembly?.findings ?? []).find(
        (finding) => finding.siteId === id && finding.code in NOT_MODELED_REASONS,
      )?.code;
      return {
        id,
        address: entry ? unitAddress(entry, candidates) : "Saved unit",
        reason: (code && NOT_MODELED_REASONS[code]) ?? "it couldn't be modeled",
      };
    });
}

/** Plain-language notes for a listing; flags that are noise or unknown are dropped. */
export function listingNotes(entry: WorkspaceCandidate): string[] {
  const text: Record<string, string> = {
    endcap_position: "End-cap unit",
    frontage_building_level:
      "Frontage is for the whole building, not just this unit",
    nnn_opex_estimated:
      "Triple-net lease: taxes, insurance and upkeep are extra (estimated)",
    nnn_opex_override: "Using your estimate for extra lease costs",
    opex_unknown: "Extra operating costs aren't listed",
    opex_assumed_included: "Operating costs assumed included in rent",
  };
  return [
    ...new Set(
      entry.flags.flatMap((flag) => (text[flag] ? [text[flag]] : [])),
    ),
  ];
}

export const rentText = (entry: WorkspaceCandidate) =>
  entry.baseRentCents.value === null
    ? "Not listed"
    : metricText(entry.baseRentCents) + "/mo";
export const areaText = (entry: WorkspaceCandidate) =>
  entry.candidate.floorAreaSqFt.value === null
    ? "Not listed"
    : metricText(entry.candidate.floorAreaSqFt) + " sq ft";

export function scannedInterior(value: InteriorResponse | null) {
  return value?.kind === "scan" &&
    value.provenance.scope !== "demo" &&
    value.provenance.mode !== "synthetic"
    ? value
    : null;
}

export function showcaseUrl(
  scan: NonNullable<ReturnType<typeof scannedInterior>>,
) {
  const query = new URLSearchParams({ m: scan.modelId, play: "1", qs: "1" });
  if (scan.showcaseParams?.sdkKey)
    query.set("applicationKey", scan.showcaseParams.sdkKey);
  return `https://my.matterport.com/show/?${query}`;
}

/** Small explanations of known listing facts, not an AI score or an exact-fit promise. */
export function candidateFitReasons(
  entry: WorkspaceCandidate,
  profile: import("@/lib/contracts").BusinessProfile | undefined,
): string[] {
  if (!profile) return [];
  const reasons: string[] = [];
  const ceiling = profile.economics.monthlyRentCeilingCents.value;
  const rent = entry.baseRentCents;
  if (
    rent.value !== null &&
    rent.unit === "USD cents/month" &&
    rent.origin !== "default" &&
    ceiling !== null &&
    rent.value <= ceiling
  )
    reasons.push("Within rent limit");
  const labels = {
    groundFloor: "Ground floor listed",
    parking: "Building parking listed",
    frontage: "Building frontage listed",
    corner: "Building corner listed",
  } as const;
  for (const feature of Object.keys(labels) as (keyof typeof labels)[]) {
    const fact = entry.candidate.features[feature];
    if (profile.mustHaves[feature].value !== true) continue;
    if (fact.value === true && fact.origin === "costar")
      reasons.push(labels[feature]);
    else if (feature === "corner" && entry.position === "EndCap")
      reasons.push("End-cap listing");
  }
  if (
    entry.candidate.city.trim().toLowerCase() ===
    profile.city.trim().toLowerCase()
  )
    reasons.push(`In ${entry.candidate.city}`);
  return reasons.slice(0, 2);
}

export function searchFilterLabel(name: string): string {
  return (
    {
      city: "City",
      activeForLease: "Active lease listings",
      retailUse: "Retail use",
      size: "Size",
      rentCeiling: "Rent limit",
      "mustHave.groundFloor": "Ground floor",
      "mustHave.corner": "Corner or end-cap",
      "mustHave.frontage": "Frontage",
      "mustHave.parking": "Parking",
    }[name] ?? name
  );
}

export function searchPresentation(
  search:
    import("@/lib/client/use-site-search").SiteSearchReadiness | undefined,
  loading: boolean,
) {
  switch (search?.status) {
    case "needs_brief":
      return { label: "Complete your brief", action: "finish_brief" } as const;
    case "error":
      return { label: "Listings unavailable", action: "retry" } as const;
    case "empty":
      return { label: "No matching spaces", action: "revise" } as const;
    case "loading":
      return { label: "Finding spaces…", action: null } as const;
    default:
      return loading
        ? ({ label: "Finding spaces…", action: null } as const)
        : ({ label: "Listings unavailable", action: "retry" } as const);
  }
}
