import { z } from "zod";
import { SpatialDraftSchema, type SpatialDraft } from "@/lib/contracts/spatial";
import { furnitureById } from "@/lib/furniture/catalog";
const point = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();
export const InteriorCalibrationSchema = z
  .object({
    modelId: z.string().regex(/^[A-Za-z0-9]{11}$/),
    origin: point,
    rotationY: z.number().finite(),
    roomAnchor: z
      .object({ x: z.number().finite(), z: z.number().finite() })
      .strict(),
    source: z.enum([
      "illustrative-reference",
      "room-bounds",
      "verified",
      "authored-preset",
      "scan-floor-placement",
    ]),
  })
  .strict();
export type InteriorCalibration = z.infer<typeof InteriorCalibrationSchema>;
export type InteriorProposalItem = {
  id: string;
  catalogId: string;
  assetUrl: string;
  position: z.infer<typeof point>;
  rotationY: number;
  widthM: number;
  depthM: number;
  heightM: number;
  modelOffsetM: [number, number, number];
};
export type InteriorProposal = {
  draftId: string;
  projectId: string;
  siteId: string;
  revision: number;
  calibration: InteriorCalibration;
  items: InteriorProposalItem[];
  defurnish: { available: null; reason: string };
  limitations: string[];
};
/** Rigid metric mapping only; the replay's illustrative root scale is never applied. */
export function buildInteriorProposal(
  input: SpatialDraft,
  raw: InteriorCalibration,
): InteriorProposal {
  const draft = SpatialDraftSchema.parse(input),
    calibration = InteriorCalibrationSchema.parse(raw),
    cos = Math.cos(calibration.rotationY),
    sin = Math.sin(calibration.rotationY);
  const ids = new Set<string>();
  const items = draft.items.map((item) => {
    if (ids.has(item.id))
      throw new Error("Duplicate proposal furniture identity");
    ids.add(item.id);
    const source = furnitureById(item.catalogId);
    if (!source) throw new Error("Unknown furniture catalog item");
    const x = item.x - calibration.roomAnchor.x,
      z = item.z - calibration.roomAnchor.z;
    return {
      id: item.id,
      catalogId: item.catalogId,
      assetUrl: source.assetUrl,
      position: {
        x: calibration.origin.x + x * cos + z * sin,
        y: calibration.origin.y,
        z: calibration.origin.z - x * sin + z * cos,
      },
      rotationY: calibration.rotationY + (item.rotation * Math.PI) / 180,
      widthM: source.widthM,
      depthM: source.depthM,
      heightM: source.heightM,
      modelOffsetM: [...source.modelOffsetM] as [number, number, number],
    };
  });
  return {
    draftId: draft.id,
    projectId: draft.projectId,
    siteId: draft.siteId,
    revision: draft.revision,
    calibration,
    items,
    defurnish: {
      available: null,
      reason:
        "Defurnished view availability is checked on the connected Matterport model. Clearing proposed objects does not erase photographed furniture.",
    },
    limitations: [
      ...draft.limitations,
      "Furniture is a proposed metric overlay; captured scan furniture remains visible.",
      ...(calibration.source === "illustrative-reference"
        ? [
            "Reference-scan placement is illustrative, not measured selected-property geometry.",
          ]
        : []),
    ],
  };
}
