import "server-only";
import { z } from "zod";
import {
  InteriorDimensionsSchema,
  MatterportModelIdSchema,
  type InteriorDimensions,
} from "../contracts/interior";

export const MATTERPORT_MODEL_ENDPOINT =
  "https://api.matterport.com/api/models/graph";
// Official references: developers.matterport.com/api/property-intelligence/{dimensions,vector-data}/
// Only query operations are allowed. No assets, mutations, unlocking or purchases.
export const INTERIOR_DIMENSIONS_QUERY = `query InteriorDimensions($modelId: ID!) {
  model(id: $modelId) {
    id
    floors { id dimensionEstimates(units: metric) { area units } }
    rooms {
      id floor { id }
      dimensionEstimates(units: metric) { area height lowerElevation units }
      boundary { edges { vertices { position { x y } } } }
    }
  }
}`;
const metric = z.object({
  area: z.number().finite().positive(),
  units: z.literal("metric"),
});
const wireSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    model: z.object({
      id: MatterportModelIdSchema,
      floors: z
        .array(z.object({ id: z.string().min(1), dimensionEstimates: metric }))
        .min(1)
        .max(100),
      rooms: z
        .array(
          z.object({
            id: z.string().min(1),
            floor: z.object({ id: z.string().min(1) }),
            dimensionEstimates: metric.extend({
              height: z.number().finite().positive(),
              lowerElevation: z.number().finite(),
            }),
            boundary: z.object({
              edges: z
                .array(
                  z.object({
                    vertices: z
                      .array(
                        z.object({
                          position: z.object({
                            x: z.number().finite(),
                            y: z.number().finite(),
                          }),
                        }),
                      )
                      .length(2),
                  }),
                )
                .min(3)
                .max(4000),
            }),
          }),
        )
        .min(1)
        .max(1000),
    }),
  }),
});
const squareMetersToSquareFeet = 1 / 0.09290304;

/** Conservative normalization: no partial geometry, guessed heights or elevations. */
export function normalizeMatterportDimensions(
  input: unknown,
  modelId: string,
): InteriorDimensions | undefined {
  const parsed = wireSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.errors?.length ||
    parsed.data.data.model.id !== modelId
  )
    return;
  const model = parsed.data.data.model;
  if (
    model.rooms.some(
      (room) => !model.floors.some((floor) => floor.id === room.floor.id),
    )
  )
    return;
  const normalizedRooms = model.rooms.map((room) => {
    const vertices = room.boundary.edges.flatMap((edge) =>
      edge.vertices.map((vertex) => vertex.position),
    );
    const { height, lowerElevation, area } = room.dimensionEstimates;
    return {
      id: room.id,
      floorId: room.floor.id,
      areaSqFt: area * squareMetersToSquareFeet,
      bounds: {
        min: {
          x: Math.min(...vertices.map((v) => v.x)),
          y: lowerElevation,
          z: Math.min(...vertices.map((v) => v.y)),
        },
        max: {
          x: Math.max(...vertices.map((v) => v.x)),
          y: lowerElevation + height,
          z: Math.max(...vertices.map((v) => v.y)),
        },
      },
    };
  });
  if (
    model.floors.some(
      (floor) => !normalizedRooms.some((room) => room.floorId === floor.id),
    )
  )
    return;
  const result = InteriorDimensionsSchema.safeParse({
    coordinateUnit: "meters",
    areaUnit: "square_feet",
    upAxis: "y",
    floors: model.floors.map((floor) => {
      const rooms = normalizedRooms.filter((room) => room.floorId === floor.id);
      return {
        id: floor.id,
        areaSqFt: floor.dimensionEstimates.area * squareMetersToSquareFeet,
        bounds: {
          min: {
            x: Math.min(...rooms.map((r) => r.bounds.min.x)),
            y: Math.min(...rooms.map((r) => r.bounds.min.y)),
            z: Math.min(...rooms.map((r) => r.bounds.min.z)),
          },
          max: {
            x: Math.max(...rooms.map((r) => r.bounds.max.x)),
            y: Math.max(...rooms.map((r) => r.bounds.max.y)),
            z: Math.max(...rooms.map((r) => r.bounds.max.z)),
          },
        },
        rooms: rooms.map(({ id, areaSqFt, bounds }) => ({
          id,
          areaSqFt,
          bounds,
        })),
      };
    }),
    provenance: {
      origin: "matterport",
      provider: "matterport",
      mode: "live",
      scope: "space",
      description:
        "Matterport Property Intelligence dimension estimates and axis-aligned bounds from room boundary vertices",
      sourceUrl: "https://developers.matterport.com/api/property-intelligence/",
      retrievedAt: new Date().toISOString(),
      limitations: [
        "Enterprise Property Intelligence access is required",
        "Native model XY and Z elevation are mapped to application Y-up coordinates",
        "Bounds enclose room boundaries; they are not exact room polygons or usable-capacity guarantees",
      ],
    },
  });
  return result.success ? result.data : undefined;
}

export type MatterportModelClient = {
  getDimensions(modelId: string): Promise<InteriorDimensions | undefined>;
};

export function createMatterportModelClient(options: {
  /** Canonical deployment slot: TokenID:TokenSecret, never a bearer token. */
  token: string;
  approvedModelIds: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
}): MatterportModelClient {
  if (!/^[^:\s]+:[^\s]+$/.test(options.token))
    throw new Error("Invalid Matterport configuration");
  const approved = new Set(
    options.approvedModelIds.map((id) => MatterportModelIdSchema.parse(id)),
  );
  const authorization = `Basic ${Buffer.from(options.token).toString("base64")}`;
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!(timeoutMs > 0 && timeoutMs <= 5000))
    throw new Error("Invalid Matterport configuration");
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    async getDimensions(modelId) {
      if (
        !approved.has(modelId) ||
        !MatterportModelIdSchema.safeParse(modelId).success
      )
        return;
      try {
        const response = await doFetch(MATTERPORT_MODEL_ENDPOINT, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({
            query: INTERIOR_DIMENSIONS_QUERY,
            variables: { modelId },
          }),
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1_048_576) {
              await reader.cancel();
              return;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return normalizeMatterportDimensions(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          modelId,
        );
      } catch {
        return;
      } // Never return provider errors, bodies, credentials or partial data.
    },
  };
}
