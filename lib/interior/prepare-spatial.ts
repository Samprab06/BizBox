import {
  InteriorResponseSchema,
  type InteriorResponse,
} from "@/lib/contracts/interior";
import { SpatialDraftSchema, type SpatialDraft } from "@/lib/contracts/spatial";
import { validateGeometry } from "@/lib/spatial/geometry";
import type { InteriorCalibration } from "./proposal-state";

/** The first supported room envelope, never a parent-property approximation of a suite. */
function selectedEnvelope(raw: InteriorResponse) {
  const parsed = InteriorResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const response = parsed.data;
  if (
    response.kind !== "scan" ||
    response.provenance.scope !== "space" ||
    !response.dimensions ||
    response.dimensions.coordinateFrame !== "showcase-y-up-v1" ||
    response.dimensions.provenance.scope !== "space" ||
    response.dimensions.provenance.provider !== "matterport" ||
    response.dimensions.provenance.origin !== "matterport"
  )
    return null;
  for (const floor of response.dimensions.floors) {
    for (const room of floor.rooms) {
      const widthM = room.bounds.max.x - room.bounds.min.x;
      const depthM = room.bounds.max.z - room.bounds.min.z;
      if (widthM >= 4 && widthM <= 30 && depthM >= 4 && depthM <= 30)
        return {
          modelId: response.modelId,
          floorId: floor.id,
          room,
          widthM,
          depthM,
        };
    }
  }
  return null;
}

function scanBinding(
  envelope: NonNullable<ReturnType<typeof selectedEnvelope>>,
) {
  return {
    modelId: envelope.modelId,
    floorId: envelope.floorId,
    roomId: envelope.room.id,
    min: { ...envelope.room.bounds.min },
    max: { ...envelope.room.bounds.max },
  };
}

/** Initializes an empty proposal; existing furniture is never resized, dropped or moved. */
export function prepareSpatialDraft(
  input: SpatialDraft,
  response: InteriorResponse,
): SpatialDraft {
  const draft = SpatialDraftSchema.parse(input),
    envelope = selectedEnvelope(response);
  if (!envelope || draft.items.length) return input;
  const { widthM, depthM } = envelope;
  if (
    draft.room.source === "matterport-bounds" &&
    draft.room.widthM === widthM &&
    draft.room.depthM === depthM &&
    JSON.stringify(draft.room.scan) === JSON.stringify(scanBinding(envelope))
  )
    return input;
  const relative = (point: { x: number; z: number }) => ({
    x: (point.x / draft.room.widthM) * widthM,
    z: (point.z / draft.room.depthM) * depthM,
  });
  return validateGeometry(
    SpatialDraftSchema.parse({
      ...draft,
      revision: draft.revision + 1,
      room: {
        widthM,
        depthM,
        source: "matterport-bounds",
        scan: scanBinding(envelope),
      },
      entrance: relative(draft.entrance),
      servicePoint: relative(draft.servicePoint),
      limitations: [
        ...draft.limitations.filter(
          (note) => !note.startsWith("Authored rectangular room"),
        ),
        "Approximate rectangular envelope from the first supported selected-suite Matterport room bounds; walls, openings and baseline furniture are not reconstructed.",
        "Entrance and service locations are proportional assumptions, not detected or measured business infrastructure.",
      ].filter((note, index, notes) => notes.indexOf(note) === index),
    }),
  );
}

/** Coordinate alignment only: the experiment still uses an approximate room envelope. */
export function spatialScanCalibration(
  response: InteriorResponse,
  draft: SpatialDraft,
): InteriorCalibration | null {
  const envelope = selectedEnvelope(response);
  if (
    !envelope ||
    draft.room.source !== "matterport-bounds" ||
    JSON.stringify(draft.room.scan) !== JSON.stringify(scanBinding(envelope)) ||
    draft.room.widthM !== envelope.widthM ||
    draft.room.depthM !== envelope.depthM
  )
    return null;
  return {
    modelId: envelope.modelId,
    origin: { ...envelope.room.bounds.min },
    rotationY: 0,
    roomAnchor: { x: 0, z: 0 },
    source: "room-bounds",
  };
}
