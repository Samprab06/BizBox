import {
  InteriorResponseSchema,
  type InteriorDimensions,
  type InteriorProvenance,
  type InteriorResponse,
  type ScanPlacement,
} from "../contracts/interior";
import { getInteriorFixture } from "./fixtures";

export class InteriorNotFoundError extends Error {}
export const NO_PLACEMENT_REASON =
  "No placement calibration for this scan: the simulation overlay falls back to Modeled layout";

/** HAC-138: whether a scan can host the overlay, or why it uses Modeled layout. */
export function scanOverlay(
  response: InteriorResponse,
):
  | { mode: "scan"; placement: ScanPlacement }
  | { mode: "modeled"; reason: string } {
  if (response.kind !== "scan")
    return {
      mode: "modeled",
      reason: response.provenance.limitations[0] ?? "No scan is available",
    };
  return response.placement
    ? { mode: "scan", placement: response.placement }
    : { mode: "modeled", reason: NO_PLACEMENT_REASON };
}
export type InteriorSite = {
  siteId: string;
  propertyId: string;
  floorPlanUri: string | null;
  models: {
    modelId: string;
    spaceId: string | null;
    hasExterior: boolean | null;
    displayApproved: boolean;
    /** Public/unlisted embed check result (HAC-137); null when never checked. */
    isPublic: boolean | null;
    dimensions: InteriorDimensions | null;
    /** HAC-138: authored overlay placement; absent/null when uncalibrated. */
    placement?: ScanPlacement | null;
    source: InteriorProvenance;
  }[];
};
export type InteriorSiteReader = (
  siteId: string,
) => Promise<InteriorSite | null>;
export type InteriorModelMapping = {
  modelId: string;
  propertyId: string;
  spaceId: string | null;
};
export type InteriorDimensionsProvider = (
  mapping: InteriorModelMapping,
) => Promise<InteriorDimensions | undefined>;

export async function resolveInterior(
  siteId: string,
  read: InteriorSiteReader,
  options: {
    allowLicensedAssets?: boolean;
    sdkKey?: string;
    dimensionsProvider?: InteriorDimensionsProvider;
  } = {},
): Promise<InteriorResponse> {
  const fixture = getInteriorFixture(siteId);
  if (fixture) return fixture;
  const site = await read(siteId);
  if (!site) throw new InteriorNotFoundError();
  if (options.allowLicensedAssets === true) {
    const model = site.models
      .filter(
        (model) =>
          // Without Enterprise Private Model Embed only public/unlisted scans
          // can be shown, and a public scan still needs explicit approval.
          model.displayApproved &&
          model.isPublic === true &&
          (model.spaceId === siteId || model.spaceId === null),
      )
      .sort(
        (a, b) =>
          Number(b.spaceId === siteId) - Number(a.spaceId === siteId) ||
          a.modelId.localeCompare(b.modelId),
      )[0];
    if (model) {
      let dimensions = model.dimensions ?? undefined;
      if (!dimensions && options.dimensionsProvider) {
        try {
          dimensions = await options.dimensionsProvider({
            modelId: model.modelId,
            propertyId: site.propertyId,
            spaceId: model.spaceId,
          });
        } catch {
          /* A scan remains displayable without provider geometry. */
        }
      }
      const scope = model.spaceId === null ? "property" : "space";
      const scopeLimitations =
        model.spaceId === null
          ? [
              "Parent-property scan is not verified suite geometry; do not derive suite capacity from it",
            ]
          : [];
      const geometryLimitations = dimensions
        ? []
        : [
            "Dimensions unavailable: no complete approved room metrics and boundary cache",
          ];
      const placementLimitations = model.placement ? [] : [NO_PLACEMENT_REASON];
      return InteriorResponseSchema.parse({
        kind: "scan",
        modelId: model.modelId,
        ...(options.sdkKey?.trim()
          ? { showcaseParams: { sdkKey: options.sdkKey.trim() } }
          : {}),
        ...(dimensions
          ? {
              dimensions: {
                ...dimensions,
                provenance: {
                  ...dimensions.provenance,
                  scope,
                  limitations: [
                    ...dimensions.provenance.limitations,
                    ...scopeLimitations,
                  ],
                },
              },
            }
          : {}),
        ...(model.placement ? { placement: model.placement } : {}),
        provenance: {
          ...model.source,
          scope,
          limitations: [
            ...model.source.limitations,
            ...scopeLimitations,
            ...geometryLimitations,
            ...placementLimitations,
          ],
        },
      });
    }
    if (site.floorPlanUri)
      return InteriorResponseSchema.parse({
        kind: "floorplan",
        floorPlanUri: site.floorPlanUri,
        provenance: {
          origin: "costar",
          provider: "costar",
          mode: "live",
          scope: "space",
          description: "Selected listing space floorPlan attachment",
          limitations: ["Listing floor plan is not measured scan geometry"],
        },
      });
  }
  return InteriorResponseSchema.parse({
    kind: "modeled",
    provenance: {
      origin: "default",
      provider: "modeled",
      mode: "live",
      scope: "space",
      description: "Modeled layout fallback; no scanned dimensions claimed",
      limitations: [
        options.allowLicensedAssets
          ? "No approved public scan or usable floor plan is available"
          : "Licensed interior display remains gated pending HAC-14 access and terms",
      ],
    },
  });
}
