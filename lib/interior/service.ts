import {
  InteriorResponseSchema,
  type InteriorDimensions,
  type InteriorDiscovery,
  type InteriorProvenance,
  type InteriorResponse,
  type ScanPlacement,
} from "../contracts/interior";
import { MatterportModelIdSchema } from "../contracts/interior";
import {
  propertyAmenityTourTitle,
  type InteriorPublicChecker,
} from "./public-checker";
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
  discovery?: InteriorDiscovery;
  /** Set only by canonical database projection, never request bodies. */
  trustedDiscovery?: true;
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
    publicChecker?: InteriorPublicChecker;
  } = {},
): Promise<InteriorResponse> {
  const fixture = getInteriorFixture(siteId);
  if (fixture) return fixture;
  const inputSite = await read(siteId);
  const site = inputSite ? structuredClone(inputSite) : null;
  if (!site) throw new InteriorNotFoundError();
  if (options.allowLicensedAssets === true) {
    let model = site.models
      .filter(
        (model) =>
          // Without Enterprise Private Model Embed only public/unlisted scans
          // can use the reviewed-registry path. Trusted discovered links are checked below.
          model.displayApproved &&
          model.isPublic === true &&
          (model.spaceId === siteId || model.spaceId === null),
      )
      .sort(
        (a, b) =>
          Number(b.spaceId === siteId) - Number(a.spaceId === siteId) ||
          a.modelId.localeCompare(b.modelId),
      )[0];
    if (site.trustedDiscovery && options.publicChecker && site.discovery) {
      const candidates = [...site.discovery.models]
        .filter((m) => MatterportModelIdSchema.safeParse(m.modelId).success)
        .sort(
          (a, b) =>
            Number(b.scope === "space") - Number(a.scope === "space") ||
            a.modelId.localeCompare(b.modelId),
        );
      let checked = 0;
      for (const candidate of candidates) {
        if (
          model &&
          (model.spaceId === siteId || candidate.scope === "property")
        )
          break;
        if (checked >= 3) break;
        checked++;
        let status: "public" | "private" | "unknown" = "unknown";
        try {
          const metadata = options.publicChecker.inspect
            ? await options.publicChecker.inspect(candidate.modelId)
            : undefined;
          status =
            metadata?.status ??
            (await options.publicChecker(candidate.modelId));
          if (
            metadata?.excludedBusinessTour ||
            (candidate.scope === "property" &&
              metadata?.title &&
              propertyAmenityTourTitle(metadata.title))
          ) {
            candidate.publicStatus = status;
            candidate.viewingEligible = false;
            candidate.reason =
              "Public tour title identifies a dwelling or communal amenity, not a verified selected business interior";
            continue;
          }
        } catch {
          /* unavailable is not viewing permission */
        }
        candidate.publicStatus = status;
        candidate.viewingEligible = status === "public";
        candidate.reason =
          status === "public"
            ? "Verified public CoStar-linked scan; automatic viewing authorized, registry approval unchanged"
            : `Public verification ${status}; automatic viewing unavailable`;
        if (status !== "public") continue;
        model = {
          modelId: candidate.modelId,
          spaceId: candidate.scope === "space" ? siteId : null,
          hasExterior: null,
          displayApproved: false,
          isPublic: true,
          dimensions: null,
          placement: null,
          source: {
            origin: "costar",
            provider: "matterport",
            mode: "live",
            scope: candidate.scope,
            description: `Canonical selected-site CoStar attachment ${candidate.sourceField}; current public Matterport metadata verified`,
            limitations: [
              "Automatic public viewing is authorized independently of registry display approval. Public embed verification does not establish SDK access, Defurnish, usable geometry or business identity.",
            ],
          },
        };
        break;
      }
    }
    if (model) {
      let dimensions = model.dimensions ?? undefined;
      if (
        (!dimensions || dimensions.coordinateFrame !== "showcase-y-up-v1") &&
        options.dimensionsProvider &&
        (model.displayApproved || model.spaceId === null)
      ) {
        try {
          const replacement = await options.dimensionsProvider({
            modelId: model.modelId,
            propertyId: site.propertyId,
            spaceId: model.spaceId,
          });
          if (
            replacement?.coordinateFrame === "showcase-y-up-v1" ||
            !dimensions
          )
            dimensions = replacement;
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
      const frameLimitations =
        dimensions && dimensions.coordinateFrame !== "showcase-y-up-v1"
          ? [
              "Legacy geometry coordinate frame is unverified; no calibrated overlay until an approved read-only refresh succeeds",
            ]
          : [];
      const placementLimitations = model.placement ? [] : [NO_PLACEMENT_REASON];
      return InteriorResponseSchema.parse({
        kind: "scan",
        ...(site.discovery ? { discovery: site.discovery } : {}),
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
                    ...frameLimitations,
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
            ...frameLimitations,
            ...placementLimitations,
          ],
        },
      });
    }
    if (site.floorPlanUri)
      return InteriorResponseSchema.parse({
        kind: "floorplan",
        ...(site.discovery ? { discovery: site.discovery } : {}),
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
    ...(site.discovery ? { discovery: site.discovery } : {}),
    provenance: {
      origin: "default",
      provider: "modeled",
      mode: "live",
      scope: "space",
      description: "Modeled layout fallback; no scanned dimensions claimed",
      limitations: [
        options.allowLicensedAssets
          ? site.discovery?.models.some((m) =>
              m.reason.includes("dwelling or communal amenity"),
            )
            ? "No verified selected business scan is available; discovered public tours identify dwelling units or communal amenities, not the selected commercial space"
            : "No approved public scan or usable floor plan is available"
          : "Licensed interior display remains gated pending HAC-14 access and terms",
      ],
    },
  });
}
