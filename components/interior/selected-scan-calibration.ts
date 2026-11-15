import type { InteriorResponse } from "@/lib/contracts/interior";
import type { SpatialDraft } from "@/lib/contracts/spatial";
import {
  InteriorCalibrationSchema,
  type InteriorCalibration,
} from "@/lib/interior/proposal-state";
import { spatialScanCalibration } from "@/lib/interior/prepare-spatial";
export type AuthoredCalibrationScope = {
  projectId: string;
  siteId: string;
  widthM: number;
  depthM: number;
};
/** A deliberately authored proposal cannot become a mapping for another site or envelope. */
export function selectedScanCalibration(
  response: InteriorResponse,
  draft: SpatialDraft,
  authored?: InteriorCalibration,
  scope?: AuthoredCalibrationScope,
): InteriorCalibration | null {
  const measured = spatialScanCalibration(response, draft);
  if (measured) return measured;
  const alignment = draft.room.alignment;
  if (
    response.kind === "scan" &&
    alignment &&
    draft.room.source === "assumed" &&
    alignment.modelId === response.modelId &&
    alignment.projectId === draft.projectId &&
    alignment.siteId === draft.siteId &&
    alignment.draftId === draft.id &&
    alignment.widthM === draft.room.widthM &&
    alignment.depthM === draft.room.depthM
  ) {
    return InteriorCalibrationSchema.parse({
      modelId: alignment.modelId,
      origin: alignment.origin,
      rotationY: alignment.rotationY,
      roomAnchor: alignment.roomAnchor,
      source: "scan-floor-placement",
    });
  }

  if (
    !authored ||
    !scope ||
    response.kind !== "scan" ||
    response.modelId !== authored.modelId ||
    scope.projectId !== draft.projectId ||
    scope.siteId !== draft.siteId ||
    draft.room.source !== "assumed" ||
    scope.widthM !== draft.room.widthM ||
    scope.depthM !== draft.room.depthM ||
    scope.widthM < 4 ||
    scope.widthM > 30 ||
    scope.depthM < 4 ||
    scope.depthM > 30
  )
    return null;
  const parsed = InteriorCalibrationSchema.safeParse(authored);
  if (!parsed.success || parsed.data.source !== "authored-preset") return null;
  return parsed.data;
}
