/**
 * HAC-97 (SIM-13): the interior layout helper.
 *
 * Turns the room bounds recorded by SIM-12 (`InteriorDimensions`) into a proposed
 * entrance, a counter with a row of stations and a queue polyline, so simulation
 * agents can be placed inside a room. The output is a pure function of its inputs
 * and is JSON-serializable (`InteriorLayoutSchema`), so a stored copy reproduces
 * the same placements.
 *
 * The helper never invents geometry: without recorded bounds it returns `null` and
 * callers use `modeledLayout`, which is the existing modeled café layout and is
 * always labelled "Modeled layout". The entrance wall, counter and stations are
 * proposed placements inside the recorded bounds, not measured fixtures.
 *
 * Coordinates are metres on the floor plane: `x` and `z` (the contract's `upAxis`
 * is `y`).
 */
import { z } from "zod";
import type { InteriorDimensions } from "../contracts/interior";

export type FloorPoint = { x: number; z: number };
export type EntranceWall = "minZ" | "maxZ" | "minX" | "maxX";

/**
 * Placement conventions in metres. They space proposed objects inside recorded
 * bounds; they are not measurements of any property.
 */
export const LAYOUT_CONVENTIONS = {
  /** Clearance kept between walls and proposed objects. */
  wallInsetM: 0.6,
  /** Staff zone between the back wall and the counter line. */
  staffZoneM: 1.2,
  /** Where a served customer stands in front of the counter. */
  serviceOffsetM: 0.6,
  /** Gap between the service point and the head of the line. */
  queueHeadGapM: 0.9,
  /** Distance between customers standing in line. */
  queueSpacingM: 0.8,
  /** Minimum distance between neighbouring station centres. */
  stationMinSpacingM: 1.5,
  /** How far outside the entrance arriving and leaving customers appear. */
  outsideM: 2,
} as const;

const point = z
  .object({ x: z.number().finite(), z: z.number().finite() })
  .strict();

export const InteriorLayoutSchema = z
  .object({
    version: z.literal(1),
    /** `room-bounds`: derived from SIM-12 dimensions. `modeled`: the modeled café. */
    source: z.enum(["room-bounds", "modeled"]),
    /** Deterministic identity of the inputs, for storing and reusing the output. */
    key: z.string().min(1),
    roomId: z.string().nullable(),
    entranceWall: z.enum(["minZ", "maxZ", "minX", "maxX"]),
    /** True when the caller did not supply a calibrated entrance wall. */
    entranceAssumed: z.boolean(),
    bounds: z
      .object({
        minX: z.number().finite(),
        maxX: z.number().finite(),
        minZ: z.number().finite(),
        maxZ: z.number().finite(),
      })
      .strict(),
    floorY: z.number().finite(),
    entrance: point,
    /** Where arriving customers start and leaving customers end, outside the door. */
    outside: point,
    counter: z.object({ from: point, to: point }).strict(),
    /** Customer-side service points, one per station, index = engine stationIndex. */
    stations: z.array(point),
    /** Staff positions behind the counter, one per station. */
    staff: z.array(point),
    /** Queue polyline from the head (next to be served) to the tail (by the door). */
    queue: z.array(point).min(2),
    queueSpacingM: z.number().positive(),
    /** People that fit on the queue polyline; more extend past the tail. */
    queueCapacity: z.number().int().nonnegative(),
    /** False when the stations or line do not fit the bounds at the conventions. */
    fits: z.boolean(),
    limitations: z.array(z.string().min(1)),
  })
  .strict();
export type InteriorLayout = z.infer<typeof InteriorLayoutSchema>;

export type RoomBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundPoint = (p: FloorPoint): FloorPoint => ({
  x: round(p.x),
  z: round(p.z),
});

/** Polyline length in metres. */
export function polylineLength(points: readonly FloorPoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].z - points[i - 1].z,
    );
  return total;
}

/**
 * The point `distance` metres along a polyline. Past the end it continues along the
 * last segment's direction, so an over-long line extends beyond its tail instead of
 * stacking people on one spot.
 */
export function pointAlong(
  points: readonly FloorPoint[],
  distance: number,
): FloorPoint {
  if (points.length === 0) throw new RangeError("Empty polyline");
  if (points.length === 1 || distance <= 0) return { ...points[0] };
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length || i === points.length - 1) {
      if (length === 0) return { ...b };
      const t = remaining / length;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}

/**
 * Proposed layout inside axis-aligned room bounds. Local frame: `u` runs along the
 * entrance wall, `v` is depth from the entrance wall (0) to the back wall (depth).
 */
export function layoutFromRoomBounds(
  bounds: RoomBounds,
  stationCount: number,
  options: { entranceWall?: EntranceWall; roomId?: string | null } = {},
): InteriorLayout {
  if (!Number.isInteger(stationCount) || stationCount < 1)
    throw new RangeError("A layout needs at least one station");
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxZ > bounds.minZ))
    throw new RangeError("Room bounds need positive horizontal extent");
  const wall = options.entranceWall ?? "minZ";
  const c = LAYOUT_CONVENTIONS;
  const alongX = wall === "minZ" || wall === "maxZ";
  const width = alongX ? bounds.maxX - bounds.minX : bounds.maxZ - bounds.minZ;
  const depth = alongX ? bounds.maxZ - bounds.minZ : bounds.maxX - bounds.minX;
  const toFloor = (u: number, v: number): FloorPoint => {
    switch (wall) {
      case "minZ":
        return { x: bounds.minX + u, z: bounds.minZ + v };
      case "maxZ":
        return { x: bounds.maxX - u, z: bounds.maxZ - v };
      case "minX":
        return { x: bounds.minX + v, z: bounds.maxZ - u };
      case "maxX":
        return { x: bounds.maxX - v, z: bounds.minZ + u };
    }
  };
  const limitations = [
    "Entrance, counter and stations are proposed placements inside recorded room bounds, not measured fixtures",
  ];
  if (!options.entranceWall)
    limitations.push(
      "Entrance wall is assumed (room minimum-z wall); it has not been calibrated against the scan",
    );

  const usableWidth = Math.max(0, width - 2 * c.wallInsetM);
  const stationsFit =
    stationCount === 1
      ? usableWidth >= 0
      : usableWidth / (stationCount - 1) >= c.stationMinSpacingM;
  const spacing = stationCount === 1 ? 0 : usableWidth / (stationCount - 1);
  const stationU = (index: number) =>
    stationCount === 1 ? width / 2 : c.wallInsetM + spacing * index;
  const counterV = Math.max(0, depth - c.staffZoneM);
  const serviceV = Math.max(0, counterV - c.serviceOffsetM);
  const staffV = (depth + counterV) / 2;
  const headV = serviceV - c.queueHeadGapM;
  const tailV = c.wallInsetM;
  const queueFits = headV > tailV;
  const center = width / 2;
  const queue = queueFits
    ? [toFloor(center, headV), toFloor(center, tailV)]
    : [toFloor(center, Math.max(0, headV)), toFloor(center, 0)];
  const queueCapacity = queueFits
    ? Math.floor((headV - tailV) / c.queueSpacingM) + 1
    : 0;
  if (!stationsFit)
    limitations.push(
      `${stationCount} stations do not fit the room width at ${c.stationMinSpacingM} m spacing`,
    );
  if (!queueFits)
    limitations.push(
      "The room is too shallow for a line between the entrance and the counter",
    );

  const key = [
    "room-bounds",
    options.roomId ?? "-",
    wall,
    stationCount,
    round(bounds.minX),
    round(bounds.maxX),
    round(bounds.minZ),
    round(bounds.maxZ),
    round(bounds.floorY),
  ].join(":");
  return InteriorLayoutSchema.parse({
    version: 1,
    source: "room-bounds",
    key,
    roomId: options.roomId ?? null,
    entranceWall: wall,
    entranceAssumed: !options.entranceWall,
    bounds: {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
    },
    floorY: bounds.floorY,
    entrance: roundPoint(toFloor(center, 0)),
    outside: roundPoint(toFloor(center, -c.outsideM)),
    counter: {
      from: roundPoint(toFloor(c.wallInsetM, counterV)),
      to: roundPoint(toFloor(width - c.wallInsetM, counterV)),
    },
    stations: Array.from({ length: stationCount }, (_, index) =>
      roundPoint(toFloor(stationU(index), serviceV)),
    ),
    staff: Array.from({ length: stationCount }, (_, index) =>
      roundPoint(toFloor(stationU(index), staffV)),
    ),
    queue: queue.map(roundPoint),
    queueSpacingM: c.queueSpacingM,
    queueCapacity,
    fits: stationsFit && queueFits,
    limitations,
  });
}

/**
 * Layout from SIM-12 dimensions. Uses the requested room, else the largest room on
 * the first floor (ties by ID), else the floor's own bounds. Returns `null` when no
 * dimensions are available, so callers fall back to `modeledLayout`.
 */
export function layoutFromDimensions(
  dimensions: InteriorDimensions | null | undefined,
  stationCount: number,
  options: { entranceWall?: EntranceWall; roomId?: string } = {},
): InteriorLayout | null {
  if (!dimensions) return null;
  const floors = dimensions.floors;
  const withRoom = options.roomId
    ? floors.find((floor) =>
        floor.rooms.some((room) => room.id === options.roomId),
      )
    : undefined;
  const floor = withRoom ?? floors[0];
  if (!floor) return null;
  const room = options.roomId
    ? floor.rooms.find((candidate) => candidate.id === options.roomId)
    : [...floor.rooms].sort(
        (a, b) => b.areaSqFt - a.areaSqFt || a.id.localeCompare(b.id),
      )[0];
  if (options.roomId && !room) return null;
  const area = room ?? floor;
  const { min, max } = area.bounds;
  return layoutFromRoomBounds(
    { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, floorY: min.y },
    stationCount,
    { entranceWall: options.entranceWall, roomId: room?.id ?? floor.id },
  );
}

/** Same spacing rule the modeled café scene uses for its counters. */
function modeledStationX(index: number, count: number) {
  return (index - (count - 1) / 2) * Math.min(2.6, 6 / Math.max(1, count));
}

/**
 * The existing modeled café layout (`components/simulator/scene.tsx` and
 * `interior-state.ts`), expressed as an `InteriorLayout`: an 8 m by 6 m shop, the
 * counter row at the back and a three-row line in front of it. No property's
 * geometry is implied.
 */
export function modeledLayout(stationCount: number): InteriorLayout {
  if (!Number.isInteger(stationCount) || stationCount < 1)
    throw new RangeError("A layout needs at least one station");
  const rowStart = -2.6;
  const rowEnd = round(rowStart + 8 * 0.62);
  const queue = [
    { x: rowStart, z: 0.25 },
    { x: rowEnd, z: 0.25 },
    { x: rowEnd, z: 0.8 },
    { x: rowStart, z: 0.8 },
    { x: rowStart, z: 1.35 },
    { x: rowEnd, z: 1.35 },
  ];
  const queueSpacingM = 0.62;
  return InteriorLayoutSchema.parse({
    version: 1,
    source: "modeled",
    key: `modeled:${stationCount}`,
    roomId: null,
    entranceWall: "maxZ",
    entranceAssumed: false,
    bounds: { minX: -4, maxX: 4, minZ: -3.5, maxZ: 2.5 },
    floorY: 0,
    entrance: { x: 0, z: 2.5 },
    outside: { x: 0, z: 3.4 },
    counter: { from: { x: -3.5, z: -1.55 }, to: { x: 3.5, z: -1.55 } },
    stations: Array.from({ length: stationCount }, (_, index) => ({
      x: round(modeledStationX(index, stationCount)),
      z: -0.75,
    })),
    staff: Array.from({ length: stationCount }, (_, index) => ({
      x: round(modeledStationX(index, stationCount)),
      z: -2.45,
    })),
    queue,
    queueSpacingM,
    queueCapacity: Math.floor(polylineLength(queue) / queueSpacingM) + 1,
    fits: true,
    limitations: [
      "Modeled café layout; not a scan, floor plan or measurement of the selected space",
    ],
  });
}
