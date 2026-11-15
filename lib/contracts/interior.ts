import { z } from "zod";
import { OriginSchema } from "./index";

export const InteriorProvenanceSchema = z
  .object({
    // Local extension only; simulation/global origins remain owned by SIM-14.
    origin: z.union([OriginSchema, z.literal("matterport")]),
    provider: z.enum(["matterport", "costar", "modeled"]),
    mode: z.enum(["synthetic", "recorded", "live"]),
    scope: z.enum(["demo", "space", "property"]),
    description: z.string().trim().min(1),
    limitations: z.array(z.string().trim().min(1)),
    sourceUrl: z.url().optional(),
    retrievedAt: z.iso.datetime().optional(),
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
    /** Absent on legacy caches that predate the explicit API-to-SDK handedness fix. */
    coordinateFrame: z.literal("showcase-y-up-v1").optional(),
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

/** A Showcase sweep plus an optional camera rotation in degrees. */
export const ScanSweepSchema = z
  .object({
    sweepId: z.string().trim().min(1).max(100),
    rotation: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional(),
  })
  .strict();
export type ScanSweep = z.infer<typeof ScanSweepSchema>;
/**
 * HAC-138: per-scan overlay placement, authored per public scan because room
 * geometry (Property Intelligence) is Enterprise-only. Coordinates are Showcase
 * SDK scan space: metres, Y-up. `origin` and `rotationY` place the layout's
 * room origin; `scale` sizes the proposed counter glyphs only (positions are
 * metre-true); `floorY` is the picked floor elevation.
 */
export const ScanPlacementSchema = z
  .object({
    origin: point,
    rotationY: z.number().finite(),
    scale: z.number().finite().positive().max(10),
    floorY: z.number().finite(),
    entranceSweep: ScanSweepSchema.nullable(),
    serviceSweep: ScanSweepSchema.nullable(),
  })
  .strict();
export type ScanPlacement = z.infer<typeof ScanPlacementSchema>;

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
/** Public CoStar-linked viewing is user-authorized; registry approval remains separate. */
export const InteriorDiscoverySchema = z
  .object({
    models: z
      .array(
        z
          .object({
            modelId: MatterportModelIdSchema,
            scope: z.enum(["space", "property"]),
            sourceField: z.string().min(1).max(300),
            displayApproved: z.boolean(),
            publicStatus: z.enum(["public", "private", "unknown"]).optional(),
            viewingEligible: z.boolean().optional(),
            reason: z.string().min(1),
          })
          .strict(),
      )
      .max(8),
    truncated: z.boolean(),
    limitations: z.array(z.string()),
  })
  .strict();
export type InteriorDiscovery = z.infer<typeof InteriorDiscoverySchema>;
export const InteriorResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scan"),
      modelId: MatterportModelIdSchema,
      showcaseParams: showcaseParams.optional(),
      dimensions: InteriorDimensionsSchema.optional(),
      /** HAC-138: absent means the overlay falls back to Modeled layout. */
      placement: ScanPlacementSchema.optional(),
      provenance: InteriorProvenanceSchema,
      discovery: InteriorDiscoverySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("floorplan"),
      floorPlanUri: FloorPlanUriSchema,
      provenance: InteriorProvenanceSchema,
      discovery: InteriorDiscoverySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("modeled"),
      provenance: InteriorProvenanceSchema,
      discovery: InteriorDiscoverySchema.optional(),
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
          placement: ScanPlacementSchema.optional(),
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
