import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { InteriorResponse } from "@/lib/contracts/interior";
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
  return ids.length >= 2 ? [...ids] : [...ids, id];
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

/** A previous comparison must never masquerade as the newly selected locations. */
export function comparisonMatchesSelection(
  payload: LiveComparisonPayload | null,
  ids: readonly string[],
) {
  if (!payload || payload.outdated || payload.comparison?.synthetic !== false)
    return false;
  const actual = payload.result.sites.map((site) => site.siteId).sort();
  return JSON.stringify(actual) === JSON.stringify([...ids].sort());
}

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
