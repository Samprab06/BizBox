import {
  InteriorResponseSchema,
  type InteriorDimensions,
  type InteriorProvenance,
  type InteriorResponse,
} from "../contracts/interior";
import { getInteriorFixture } from "./fixtures";

export class InteriorNotFoundError extends Error {}
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
        provenance: {
          ...model.source,
          scope,
          limitations: [
            ...model.source.limitations,
            ...scopeLimitations,
            ...geometryLimitations,
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
