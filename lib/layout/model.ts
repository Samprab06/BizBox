import type { ZodError } from "zod";
import { categoryDefaults } from "@/lib/agent/defaults";
import {
  LayoutOpSchema,
  LayoutRoomSchema,
  LayoutSchema,
  LayoutVersionMetaSchema,
  RoomSourcesSchema,
  type Layout,
  type LayoutPolicy,
  type LayoutRoom,
  type RoomSources,
} from "@/lib/contracts/layout";
import {
  entranceStart,
  fits,
  hasAccessiblePath,
  overlaps,
  queueLength,
  rectangleDistance,
  solidElements,
  validQueuePath,
} from "./geometry";

export type LayoutFieldErrors = Record<string, string[]>;
export class LayoutInputError extends Error {
  constructor(readonly fieldErrors: LayoutFieldErrors) {
    super(
      `Invalid layout input: ${Object.entries(fieldErrors)
        .map(([path, messages]) => `${path}: ${messages.join("; ")}`)
        .join(", ")}`,
    );
    this.name = "LayoutInputError";
  }
}
function issues(error: ZodError, prefix: string): never {
  const errors: LayoutFieldErrors = {};
  for (const issue of error.issues)
    (errors[[prefix, ...issue.path].join(".")] ??= []).push(issue.message);
  throw new LayoutInputError(errors);
}
function invalid(path: string, message: string): never {
  throw new LayoutInputError({ [path]: [message] });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
const proposedDistance = (value: number) => ({
  value,
  origin: "agent-proposed" as const,
  evidenceIds: ["hac86:approximate-layout-policy:v1"],
});
/** Fresh defaults for a new root; each value is an explicit authored model assumption. */
function defaultPolicy(): LayoutPolicy {
  return {
    minClearanceFt: proposedDistance(1),
    accessibleWidthFt: proposedDistance(3),
    queueWidthFt: proposedDistance(3),
    queueSpacingFt: proposedDistance(2),
  };
}

/** Scan dimensions take precedence. Listing area supplies area, not measured aspect ratio. */
export function deriveRoomBounds(input: RoomSources): LayoutRoom {
  const parsed = RoomSourcesSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error, "sources");
  const { matterport, listing } = parsed.data;
  const width = matterport?.widthFt ?? Math.sqrt(listing!.areaSqFt);
  const depth = matterport?.depthFt ?? width;
  const evidenceIds = matterport?.evidenceIds ?? listing!.evidenceIds;
  const source = {
    origin: matterport ? ("matterport" as const) : ("costar" as const),
    evidenceIds,
  };
  const room = LayoutRoomSchema.safeParse({
    bounds: { x: 0, y: 0, width, depth },
    origin: matterport ? "matterport" : "agent-proposed",
    evidenceIds,
    areaSource: {
      value: matterport ? width * depth : listing!.areaSqFt,
      ...source,
    },
  });
  if (!room.success) return issues(room.error, "room");
  return deepFreeze(room.data);
}

/** Validate structural and geometric constraints, returning a detached, deeply frozen value. */
export function parseLayout(input: unknown): Layout {
  const parsed = LayoutSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error, "layout");
  const layout = parsed.data,
    errors: LayoutFieldErrors = {};
  const add = (path: string, message: string) =>
    (errors[`layout.${path}`] ??= []).push(message);
  if (layout.parentId === layout.layoutId)
    add("parentId", "A layout cannot be its own parent");
  const solids = solidElements(layout);
  if (solids.length > 102)
    add(
      "stations",
      "At most 100 station and seating footprints combined are supported",
    );
  const ids = new Set<string>();
  for (const { id, path } of [
    { id: layout.entrance.id, path: "entrance.id" },
    { id: layout.queuePath.id, path: "queuePath.id" },
    ...solids.map(({ path, element }) => ({
      id: element.id,
      path: `${path}.id`,
    })),
  ]) {
    if (ids.has(id)) add(path, `Duplicate element ID ${id}`);
    ids.add(id);
  }
  for (let i = 0; i < solids.length; i++) {
    const a = solids[i];
    if (!fits(a.element.footprint, layout.room.bounds))
      add(`${a.path}.footprint`, "Footprint must fit inside the room");
    for (let j = 0; j < i; j++) {
      const b = solids[j];
      if (overlaps(a.element.footprint, b.element.footprint))
        add(`${a.path}.footprint`, `Overlaps ${b.element.id}`);
      else if (
        rectangleDistance(a.element.footprint, b.element.footprint) + 1e-8 <
        layout.policy.minClearanceFt.value
      )
        add(
          `${a.path}.footprint`,
          `Needs ${layout.policy.minClearanceFt.value} ft clearance from ${b.element.id}`,
        );
    }
  }
  const roomArea = layout.room.bounds.width * layout.room.bounds.depth;
  if (
    Math.abs(layout.room.areaSource.value - roomArea) >
    Math.max(1, roomArea) * 1e-8
  )
    add(
      "room.areaSource.value",
      "Area source must equal the modeled rectangle area",
    );
  const usableSf = usableArea(layout),
    sfPerStation = categorySf(layout);
  if (layout.stations.length > Math.floor(usableSf / sfPerStation))
    add(
      "stations",
      `Category allows at most ${Math.max(0, Math.floor(usableSf / sfPerStation))} stations in ${usableSf} usable SF`,
    );
  if (!entranceStart(layout))
    add("entrance.point", "Entrance opening must fit on a room boundary");
  if (layout.entrance.widthFt < layout.policy.accessibleWidthFt.value)
    add(
      "entrance.widthFt",
      "Entrance is narrower than the modeled accessible route",
    );
  if (!validQueuePath(layout))
    add(
      "queuePath.points",
      "Queue must fit its corridor, avoid footprints, crossings, turns over 90 degrees and nearby nonadjacent segments",
    );
  // Avoid the cost of the visibility search when already invalid, especially at the input cap.
  if (Object.keys(errors).length === 0 && !hasAccessiblePath(layout))
    add("entrance", "No approximate accessible path reaches the counter");
  if (Object.keys(errors).length > 0) throw new LayoutInputError(errors);
  return deepFreeze(layout);
}
const record = (input: unknown): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input);

/** Create a root. All element/source data is required; only model policy defaults. */
export function createLayout(input: unknown): Layout {
  if (!record(input)) return parseLayout(input);
  if (input.parentId !== undefined && input.parentId !== null)
    invalid("layout.parentId", "A new root must have a null parent");
  return parseLayout({
    ...input,
    parentId: null,
    policy: input.policy === undefined ? defaultPolicy() : input.policy,
  });
}

/** Every operation validates the complete candidate; failed edits never modify the source. */
export function applyLayoutOp(
  input: Layout,
  operation: unknown,
  metadata: { layoutId: string },
): Layout {
  const parent = parseLayout(input);
  const parsedOp = LayoutOpSchema.safeParse(operation);
  if (!parsedOp.success) return issues(parsedOp.error, "op");
  const meta = LayoutVersionMetaSchema.safeParse(metadata);
  if (!meta.success) return issues(meta.error, "meta");
  if (
    meta.data.layoutId === parent.layoutId ||
    meta.data.layoutId === parent.parentId
  )
    invalid("meta.layoutId", "A new version needs a new layout ID");
  const next = structuredClone(parent),
    op = parsedOp.data;
  next.layoutId = meta.data.layoutId;
  next.parentId = parent.layoutId;
  switch (op.op) {
    case "add_station":
      next.stations.push(op.station);
      break;
    case "add_seating":
      next.seating.push(op.seating);
      break;
    case "set_queue_path":
      next.queuePath = op.queuePath;
      break;
    case "set_counter":
      next.counter = op.counter;
      break;
    case "set_entrance":
      next.entrance = op.entrance;
      break;
    case "set_back_of_house":
      next.backOfHouse = op.backOfHouse;
      break;
    case "set_room":
      next.room = op.room;
      break;
    case "set_policy":
      next.policy = op.policy;
      break;
    case "remove": {
      const collection = next.stations.some((s) => s.id === op.elementId)
        ? next.stations
        : next.seating;
      const index = collection.findIndex((s) => s.id === op.elementId);
      if (index === -1)
        invalid(
          "op.elementId",
          "Only an existing station or seating group can be removed",
        );
      collection.splice(index, 1);
      break;
    }
    case "move": {
      if (next.entrance.id === op.elementId) {
        next.entrance = {
          ...next.entrance,
          point: op.position,
          origin: op.origin,
          evidenceIds: op.evidenceIds,
        };
      } else {
        const target = solidElements(next).find(
          ({ element }) => element.id === op.elementId,
        )?.element;
        if (!target)
          invalid(
            "op.elementId",
            "Unknown movable element; use set_queue_path for the queue",
          );
        target.footprint = { ...target.footprint, ...op.position };
        target.origin = op.origin;
        target.evidenceIds = op.evidenceIds;
      }
      break;
    }
  }
  return parseLayout(next);
}

const usableArea = (layout: Layout) =>
  layout.room.areaSource.value -
  layout.backOfHouse.footprint.width * layout.backOfHouse.footprint.depth;
function categorySf(layout: Layout): number {
  // Supported categories and fixture schema guarantee a positive known default.
  const value = categoryDefaults(layout.category)?.values.squareFeetPerStation
    .value;
  if (value === null || value === undefined || value <= 0)
    invalid(
      "layout.category",
      "Category needs a positive SF-per-station default",
    );
  return value;
}

export interface LayoutSimParams {
  stationCount: number;
  queueCapacity: number;
  seatingCapacity: number;
  /** Seat-weighted mean dwell; null with no seating. Not yet consumed by queue engine. */
  dwellMin: number | null;
  usableSf: number;
  sfPerStation: number;
}
/** Capacity inputs only; no demand, price, staff, service-time or persistence side effects. */
export function deriveSimParams(input: Layout): LayoutSimParams {
  const layout = parseLayout(input);
  const seatingCapacity = layout.seating.reduce((sum, s) => sum + s.seats, 0);
  return {
    stationCount: layout.stations.length,
    queueCapacity: Math.floor(
      queueLength(layout) / layout.policy.queueSpacingFt.value,
    ),
    seatingCapacity,
    dwellMin: seatingCapacity
      ? layout.seating.reduce((sum, s) => sum + s.seats * s.dwellMin, 0) /
        seatingCapacity
      : null,
    usableSf: usableArea(layout),
    sfPerStation: categorySf(layout),
  };
}

// Exported for the diff adapter without widening the public error surface.
export const layoutError = invalid;
