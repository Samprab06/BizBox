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
    dimensions: InteriorDimensions | null;
    source: InteriorProvenance;
  }[];
};
export type InteriorSiteReader = (
  siteId: string,
) => Promise<InteriorSite | null>;

export async function resolveInterior(
  siteId: string,
  read: InteriorSiteReader,
  options: { allowLicensedAssets?: boolean; sdkKey?: string } = {},
): Promise<InteriorResponse> {
  const fixture = getInteriorFixture(siteId);
  if (fixture) return fixture;
  const site = await read(siteId);
  if (!site) throw new InteriorNotFoundError();
  if (options.allowLicensedAssets === true) {
    const model = site.models
      .filter(
        (model) =>
          model.displayApproved &&
          (model.spaceId === siteId || model.spaceId === null),
      )
      .sort(
        (a, b) =>
          Number(b.spaceId === siteId) - Number(a.spaceId === siteId) ||
          a.modelId.localeCompare(b.modelId),
      )[0];
    if (model) {
      const scope = model.spaceId === null ? "property" : "space";
      const scopeLimitations =
        model.spaceId === null
          ? [
              "Parent-property scan is not verified suite geometry; do not derive suite capacity from it",
            ]
          : [];
      return InteriorResponseSchema.parse({
        kind: "scan",
        modelId: model.modelId,
        ...(options.sdkKey?.trim()
          ? { showcaseParams: { sdkKey: options.sdkKey.trim() } }
          : {}),
        ...(model.dimensions
          ? {
              dimensions: {
                ...model.dimensions,
                provenance: {
                  ...model.dimensions.provenance,
                  scope,
                  limitations: [
                    ...model.dimensions.provenance.limitations,
                    ...scopeLimitations,
                  ],
                },
              },
            }
          : {}),
        provenance: {
          ...model.source,
          scope,
          limitations: [...model.source.limitations, ...scopeLimitations],
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
          ? "No approved scan or usable floor plan is available"
          : "Licensed interior display remains gated pending HAC-14 access and terms",
      ],
    },
  });
}
