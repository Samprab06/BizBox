import {
  InteriorResponseSchema,
  type InteriorResponse,
  type InteriorProvenance,
} from "../contracts/interior";
import publicDemo from "./__fixtures__/public-demo.json";

export const interiorFixtureIds = [
  "interior-public-demo",
  "interior-fixture-scan",
  "interior-fixture-floorplan",
  "interior-fixture-modeled",
] as const;
const provenance: InteriorProvenance = {
  origin: "default",
  provider: "modeled",
  mode: "synthetic",
  scope: "demo",
  description: "Authored synthetic interior example",
  limitations: [
    "Not a recorded Matterport scan or a candidate-space measurement",
    "The invented model ID cannot be opened in Showcase",
  ],
};

/** Compiled fixtures only: no licensed data, filesystem reads or network calls. */
export function getInteriorFixture(
  siteId: string,
): InteriorResponse | undefined {
  if (siteId === "interior-public-demo")
    return InteriorResponseSchema.parse({
      kind: "scan",
      modelId: publicDemo.modelId,
      provenance: {
        origin: "public",
        provider: "matterport",
        mode: "recorded",
        scope: "demo",
        sourceUrl: publicDemo.sourceUrl,
        retrievedAt: publicDemo.retrievedAt,
        description:
          "Captured official public-demo documentation metadata; not a recorded Model API response",
        limitations: [
          "Public example model, not the selected candidate space",
          "No approved public-demo geometry recording is available; dimensions are absent",
          "Showcase SDK connection requires an approved domain SDK key",
        ],
      },
    });
  if (siteId === "interior-fixture-scan")
    return InteriorResponseSchema.parse({
      kind: "scan",
      modelId: "Synthetic01",
      provenance,
      dimensions: {
        coordinateUnit: "meters",
        areaUnit: "square_feet",
        upAxis: "y",
        provenance,
        floors: [
          {
            id: "synthetic-floor",
            areaSqFt: 1000,
            bounds: {
              min: { x: 0, y: 0, z: 0 },
              max: { x: 10, y: 3, z: 9.290304 },
            },
            rooms: [
              {
                id: "synthetic-room",
                areaSqFt: 1000,
                bounds: {
                  min: { x: 0, y: 0, z: 0 },
                  max: { x: 10, y: 3, z: 9.290304 },
                },
              },
            ],
          },
        ],
      },
    });
  if (siteId === "interior-fixture-floorplan")
    return InteriorResponseSchema.parse({
      kind: "floorplan",
      floorPlanUri: "/api/sites/interior-fixture-floorplan/interior/floorplan",
      provenance,
    });
  if (siteId === "interior-fixture-modeled")
    return InteriorResponseSchema.parse({ kind: "modeled", provenance });
}

export const syntheticFloorPlanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="#f5f5f5"/><path d="M50 80H550V350H50Z" fill="white" stroke="#333" stroke-width="4"/><text x="50" y="40" font-family="sans-serif" font-size="20">Synthetic example — not a listing floor plan</text><text x="210" y="220" font-family="sans-serif" font-size="18">Illustrative room</text></svg>`;
