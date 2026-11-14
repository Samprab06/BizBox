import { z } from "zod";
import { OriginSchema } from "./index";

export const InteriorProvenanceSchema = z
  .object({
    origin: OriginSchema,
    provider: z.enum(["matterport", "costar", "modeled"]),
    mode: z.enum(["synthetic", "recorded", "live"]),
    scope: z.enum(["demo", "space", "property"]),
    description: z.string().trim().min(1),
    limitations: z.array(z.string().trim().min(1)),
  })
  .strict();
export type InteriorProvenance = z.infer<typeof InteriorProvenanceSchema>;
export const MatterportModelIdSchema = z.string().regex(/^[A-Za-z0-9]{11}$/);
export const InteriorSpaceIdSchema = z
  .string()
  .max(100)
  .regex(/^\d+:\d+$/);
const point = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  })
  .strict();
const bounds = z
  .object({ min: point, max: point })
  .strict()
  .refine(
    (b) => b.min.x < b.max.x && b.min.y <= b.max.y && b.min.z < b.max.z,
    "Bounds must have positive horizontal extent and ordered elevation",
  );
const room = z
  .object({
    id: z.string().min(1),
    areaSqFt: z.number().finite().positive(),
    bounds,
  })
  .strict();
export const InteriorDimensionsSchema = z
  .object({
    coordinateUnit: z.literal("meters"),
    areaUnit: z.literal("square_feet"),
    upAxis: z.literal("y"),
    floors: z.array(room.extend({ rooms: z.array(room) })).min(1),
    provenance: InteriorProvenanceSchema,
  })
  .strict()
  .superRefine((dimensions, ctx) => {
    const floors = new Set<string>();
    for (const floor of dimensions.floors) {
      if (floors.has(floor.id))
        ctx.addIssue({ code: "custom", message: "Duplicate floor ID" });
      floors.add(floor.id);
      const rooms = new Set<string>();
      for (const room of floor.rooms) {
        if (rooms.has(room.id))
          ctx.addIssue({ code: "custom", message: "Duplicate room ID" });
        rooms.add(room.id);
        if (
          room.areaSqFt > floor.areaSqFt ||
          (["x", "y", "z"] as const).some(
            (axis) =>
              room.bounds.min[axis] < floor.bounds.min[axis] ||
              room.bounds.max[axis] > floor.bounds.max[axis],
          )
        ) {
          ctx.addIssue({ code: "custom", message: "Room must fit its floor" });
        }
      }
    }
  });
export type InteriorDimensions = z.infer<typeof InteriorDimensionsSchema>;

// App-owned configuration, not an unvalidated SDK/API payload. The private token
// has no representable field in this contract.
const showcaseParams = z.object({ sdkKey: z.string().trim().min(1) }).strict();
export const FloorPlanUriSchema = z.string().refine((value) => {
  if (value === "/api/sites/interior-fixture-floorplan/interior/floorplan")
    return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Use an HTTPS floor plan or the built-in synthetic fixture");
export const InteriorResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scan"),
      modelId: MatterportModelIdSchema,
      showcaseParams: showcaseParams.optional(),
      dimensions: InteriorDimensionsSchema.optional(),
      provenance: InteriorProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("floorplan"),
      floorPlanUri: FloorPlanUriSchema,
      provenance: InteriorProvenanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("modeled"),
      provenance: InteriorProvenanceSchema,
    })
    .strict(),
]);
export type InteriorResponse = z.infer<typeof InteriorResponseSchema>;

export const MatterportManifestSchema = z
  .object({
    version: z.literal(1),
    models: z.array(
      z
        .object({
          modelId: MatterportModelIdSchema,
          costarPropertyId: z.string().max(100).regex(/^\d+$/),
          costarSpaceId: InteriorSpaceIdSchema.nullable(),
          hasExterior: z.boolean().nullable(),
          source: InteriorProvenanceSchema,
          // Importing data cannot itself approve licensed display. HAC-14 must first
          // establish access/terms and a separately reviewed activation path.
          displayApproved: z.literal(false).default(false),
          dimensions: InteriorDimensionsSchema.optional(),
          dimensionsRecordedAt: z.iso.datetime().optional(),
        })
        .strict()
        .superRefine((model, ctx) => {
          if (!!model.dimensions !== !!model.dimensionsRecordedAt)
            ctx.addIssue({
              code: "custom",
              message: "Cached dimensions require a recording timestamp",
            });
        }),
    ),
  })
  .strict();
