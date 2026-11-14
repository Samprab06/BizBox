import { z } from "zod";

/** HAC-86: feet, axis-aligned footprints, and layout-specific provenance. */
const Id = z.string().trim().min(1).max(200);
const Coordinate = z.number().finite().min(-100_000).max(100_000);
const Distance = z.number().finite().positive().max(10_000);
export const LayoutOriginSchema = z.enum([
  "matterport",
  "costar",
  "founder",
  "agent-proposed",
]);
const provenance = {
  origin: LayoutOriginSchema,
  evidenceIds: z.array(Id).min(1).max(100),
};
export const LayoutPointSchema = z
  .object({ x: Coordinate, y: Coordinate })
  .strict();
export type LayoutPoint = z.infer<typeof LayoutPointSchema>;
export const LayoutRectSchema = z
  .object({
    x: Coordinate,
    y: Coordinate,
    width: Distance,
    depth: Distance,
  })
  .strict();
export type LayoutRect = z.infer<typeof LayoutRectSchema>;
export const LayoutRoomSchema = z
  .object({
    bounds: LayoutRectSchema,
    ...provenance,
    /** Source of area, separately from an inferred shape's origin. */
    areaSource: z
      .object({
        value: z.number().finite().positive().max(100_000_000),
        ...provenance,
      })
      .strict(),
  })
  .strict();
export type LayoutRoom = z.infer<typeof LayoutRoomSchema>;
export const LayoutEntranceSchema = z
  .object({
    id: Id,
    point: LayoutPointSchema,
    widthFt: Distance,
    ...provenance,
  })
  .strict();
export const LayoutFootprintSchema = z
  .object({
    id: Id,
    footprint: LayoutRectSchema,
    ...provenance,
  })
  .strict();
export const LayoutStationSchema = LayoutFootprintSchema.extend({
  type: z.string().trim().min(1).max(100),
});
export const LayoutSeatingSchema = LayoutFootprintSchema.extend({
  seats: z.number().int().positive().max(10_000),
  dwellMin: z.number().finite().positive().max(1440),
});
export const LayoutQueuePathSchema = z
  .object({
    id: Id,
    points: z.array(LayoutPointSchema).min(2).max(64),
    ...provenance,
  })
  .strict();
const PolicyDistance = z
  .object({ value: z.number().finite().min(0.1).max(100), ...provenance })
  .strict();
export const LayoutPolicySchema = z
  .object({
    minClearanceFt: PolicyDistance,
    accessibleWidthFt: PolicyDistance,
    queueWidthFt: PolicyDistance,
    queueSpacingFt: PolicyDistance,
  })
  .strict();
export type LayoutPolicy = z.infer<typeof LayoutPolicySchema>;
/** Structural schema. Use parseLayout for geometry and category validation as well. */
export const LayoutSchema = z
  .object({
    layoutId: Id,
    parentId: Id.nullable(),
    siteId: Id,
    category: z.enum(["coffee", "quick_food", "salon_barber", "fitness"]),
    room: LayoutRoomSchema,
    entrance: LayoutEntranceSchema,
    counter: LayoutFootprintSchema,
    stations: z.array(LayoutStationSchema).min(1).max(100),
    seating: z.array(LayoutSeatingSchema).max(100),
    queuePath: LayoutQueuePathSchema,
    backOfHouse: LayoutFootprintSchema,
    policy: LayoutPolicySchema,
  })
  .strict();
export type Layout = z.infer<typeof LayoutSchema>;

export const LayoutOpSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("add_station"), station: LayoutStationSchema })
    .strict(),
  z
    .object({ op: z.literal("add_seating"), seating: LayoutSeatingSchema })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      elementId: Id,
      position: LayoutPointSchema,
      ...provenance,
    })
    .strict(),
  z.object({ op: z.literal("remove"), elementId: Id }).strict(),
  z
    .object({
      op: z.literal("set_queue_path"),
      queuePath: LayoutQueuePathSchema,
    })
    .strict(),
  z
    .object({ op: z.literal("set_counter"), counter: LayoutFootprintSchema })
    .strict(),
  z
    .object({ op: z.literal("set_entrance"), entrance: LayoutEntranceSchema })
    .strict(),
  z
    .object({
      op: z.literal("set_back_of_house"),
      backOfHouse: LayoutFootprintSchema,
    })
    .strict(),
  z.object({ op: z.literal("set_room"), room: LayoutRoomSchema }).strict(),
  z
    .object({ op: z.literal("set_policy"), policy: LayoutPolicySchema })
    .strict(),
]);
export type LayoutOp = z.infer<typeof LayoutOpSchema>;
export const LayoutVersionMetaSchema = z.object({ layoutId: Id }).strict();

export const RoomSourcesSchema = z
  .object({
    matterport: z
      .object({
        widthFt: Distance,
        depthFt: Distance,
        evidenceIds: z.array(Id).min(1).max(100),
      })
      .strict()
      .optional(),
    listing: z
      .object({
        areaSqFt: z.number().finite().positive().max(100_000_000),
        evidenceIds: z.array(Id).min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (s) => s.matterport || s.listing,
    "Matterport dimensions or listing area are required",
  );
export type RoomSources = z.infer<typeof RoomSourcesSchema>;
