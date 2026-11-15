import {
  InteriorResponseSchema,
  type InteriorDimensions,
  type InteriorProvenance,
  type InteriorResponse,
} from "@/lib/contracts/interior";

export type InteriorDisplayKind = InteriorResponse["kind"];

/** The one label each displayed source carries (SIM-13). */
export const INTERIOR_SOURCE_LABELS: Record<InteriorDisplayKind, string> = {
  scan: "Scanned interior",
  floorplan: "Listing floor plan",
  modeled: "Modeled layout",
};

export type InteriorDisplay = {
  /** What is actually drawn. The label always follows this, never the request. */
  kind: InteriorDisplayKind;
  label: string;
  /** SIM-12's kind, when a response was received. */
  sourceKind: InteriorDisplayKind | null;
  /** Why a scan or floor plan from SIM-12 is not the one drawn. */
  fallbackReason: string | null;
  provenance: InteriorProvenance | null;
  modelId?: string;
  sdkKey?: string;
  floorPlanUri?: string;
  /** Recorded room bounds for the layout helper, when SIM-12 supplied them. */
  dimensions?: InteriorDimensions;
};

export type InteriorLoad =
  | { status: "loading" }
  | { status: "ready"; interior: InteriorResponse }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Chooses what to draw from the SIM-12 response. A scan needs a Showcase SDK key;
 * without one the modeled layout is drawn and labelled as such, with the reason.
 */
export function interiorDisplay(
  load: InteriorLoad,
  options: { sdkKey?: string } = {},
): InteriorDisplay {
  const modeled = (
    reason: string | null,
    provenance: InteriorProvenance | null,
    sourceKind: InteriorDisplayKind | null,
    dimensions?: InteriorDimensions,
  ): InteriorDisplay => ({
    kind: "modeled",
    label: INTERIOR_SOURCE_LABELS.modeled,
    sourceKind,
    fallbackReason: reason,
    provenance,
    ...(dimensions ? { dimensions } : {}),
  });
  if (load.status === "loading")
    return modeled("Loading the interior for this space…", null, null);
  if (load.status === "not_found")
    return modeled("No interior record exists for this space.", null, null);
  if (load.status === "error")
    return modeled(
      "The interior service is unavailable right now.",
      null,
      null,
    );
  const { interior } = load;
  if (interior.kind === "scan") {
    const sdkKey =
      interior.showcaseParams?.sdkKey.trim() || options.sdkKey?.trim();
    if (!sdkKey)
      return modeled(
        "A scan is registered for this space, but this environment has no Matterport SDK key, so the scan cannot be shown.",
        interior.provenance,
        "scan",
        interior.dimensions,
      );
    return {
      kind: "scan",
      label: INTERIOR_SOURCE_LABELS.scan,
      sourceKind: "scan",
      fallbackReason: null,
      provenance: interior.provenance,
      modelId: interior.modelId,
      sdkKey,
      ...(interior.dimensions ? { dimensions: interior.dimensions } : {}),
    };
  }
  if (interior.kind === "floorplan")
    return {
      kind: "floorplan",
      label: INTERIOR_SOURCE_LABELS.floorplan,
      sourceKind: "floorplan",
      fallbackReason: null,
      provenance: interior.provenance,
      floorPlanUri: interior.floorPlanUri,
    };
  return modeled(null, interior.provenance, "modeled");
}

/** Reads SIM-12's interior API for one site. Never calls Matterport directly. */
export async function fetchInterior(
  siteId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<InteriorLoad> {
  try {
    const response = await fetcher(
      `/api/sites/${encodeURIComponent(siteId)}/interior`,
      { signal, headers: { accept: "application/json" } },
    );
    if (response.status === 404 || response.status === 400)
      return { status: "not_found" };
    if (!response.ok) return { status: "error" };
    const parsed = InteriorResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { status: "ready", interior: parsed.data }
      : { status: "error" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "error" };
  }
}
