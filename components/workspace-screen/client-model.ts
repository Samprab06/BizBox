import type { SiteSearchResult } from "@/lib/contracts/sites";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import type { InteriorResponse } from "@/lib/contracts/interior";

export type WorkspaceCandidate = SiteSearchResult["candidates"][number];

export function realCandidates(candidates: readonly WorkspaceCandidate[]) {
  return candidates.filter(({ candidate }) => !candidate.synthetic);
}

export function candidateCoordinates(entry: WorkspaceCandidate | undefined) {
  const latitude = entry?.candidate.latitude.value;
  const longitude = entry?.candidate.longitude.value;
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    typeof longitude === "number" &&
    Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
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
