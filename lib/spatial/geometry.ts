import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import type { SpatialDraft } from "@/lib/contracts/spatial";
type Point = { x: number; z: number };
export function itemBounds(item: SpatialDraft["items"][number]) {
  const source = FURNITURE_CATALOG.find((c) => c.id === item.catalogId);
  if (!source) throw new Error("Unknown catalog item");
  const turned = item.rotation === 90 || item.rotation === 270;
  const w = turned ? source.depthM : source.widthM,
    d = turned ? source.widthM : source.depthM;
  return {
    minX: item.x - w / 2,
    maxX: item.x + w / 2,
    minZ: item.z - d / 2,
    maxZ: item.z + d / 2,
    source,
  };
}
export function validateGeometry(draft: SpatialDraft) {
  const ids = new Set<string>();
  const bounds = draft.items.map((item) => {
    if (ids.has(item.id)) throw new Error("Duplicate furniture identity");
    ids.add(item.id);
    const b = itemBounds(item);
    if (
      b.minX < 0 ||
      b.minZ < 0 ||
      b.maxX > draft.room.widthM ||
      b.maxZ > draft.room.depthM
    )
      throw new Error("Furniture must fit inside the room");
    return b;
  });
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i]!,
        b = bounds[j]!;
      if (
        a.minX < b.maxX &&
        a.maxX > b.minX &&
        a.minZ < b.maxZ &&
        a.maxZ > b.minZ
      )
        throw new Error("Furniture footprints overlap");
    }
  for (const p of [draft.entrance, draft.servicePoint])
    if (
      p.x < 0 ||
      p.z < 0 ||
      p.x > draft.room.widthM ||
      p.z > draft.room.depthM
    )
      throw new Error("Entrance/service must be inside room");
  routeThroughRoom(draft);
  return draft;
}
/** Bounded 0.5m grid; whole grid cells touching inflated obstacles are blocked. */
export function routeThroughRoom(draft: SpatialDraft): Point[] {
  const step = 0.5,
    w = Math.floor(draft.room.widthM / step) + 1,
    h = Math.floor(draft.room.depthM / step) + 1;
  const obstacles = draft.items
    .map(itemBounds)
    .filter((b) => b.source.role !== "decor");
  const blockedPoint = (point: Point) =>
    obstacles.some(
      (b) =>
        point.x >= b.minX - 0.4 &&
        point.x <= b.maxX + 0.4 &&
        point.z >= b.minZ - 0.4 &&
        point.z <= b.maxZ + 0.4,
    );
  const blocked = (x: number, z: number) =>
    blockedPoint({ x: x * step, z: z * step });
  const segmentBlocked = (from: Point, to: Point) =>
    obstacles.some((b) => {
      let low = 0,
        high = 1;
      for (const [origin, delta, min, max] of [
        [from.x, to.x - from.x, b.minX - 0.4, b.maxX + 0.4],
        [from.z, to.z - from.z, b.minZ - 0.4, b.maxZ + 0.4],
      ]) {
        if (Math.abs(delta!) < 1e-12) {
          if (origin! < min! || origin! > max!) return false;
          continue;
        }
        const a = (min! - origin!) / delta!,
          c = (max! - origin!) / delta!;
        low = Math.max(low, Math.min(a, c));
        high = Math.min(high, Math.max(a, c));
        if (low > high) return false;
      }
      return true;
    });
  for (const p of [draft.entrance, draft.servicePoint])
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.z) ||
      p.x < 0 ||
      p.z < 0 ||
      p.x > draft.room.widthM ||
      p.z > draft.room.depthM
    )
      throw new Error("Entrance/service must be inside room");
  const snap = (p: Point) => ({
    x: Math.min(w - 1, Math.max(0, Math.round(p.x / step))),
    z: Math.min(h - 1, Math.max(0, Math.round(p.z / step))),
  });
  const start = snap(draft.entrance),
    end = snap(draft.servicePoint);
  if (
    segmentBlocked(draft.entrance, { x: start.x * step, z: start.z * step }) ||
    segmentBlocked({ x: end.x * step, z: end.z * step }, draft.servicePoint)
  )
    throw new Error("Furniture blocks endpoint connection to walking grid");
  const key = (x: number, z: number) => z * w + x;
  const startKey = key(start.x, start.z),
    endKey = key(end.x, end.z);
  if (blocked(start.x, start.z) || blocked(end.x, end.z))
    throw new Error("Furniture blocks entrance or service point");
  const queue = [startKey],
    previous = new Map<number, number>([[startKey, -1]]);
  for (let i = 0; i < queue.length && !previous.has(endKey); i++) {
    const current = queue[i]!,
      x = current % w,
      z = Math.floor(current / w);
    for (const [dx, dz] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ]) {
      const nx = x + dx!,
        nz = z + dz!;
      const k = key(nx, nz);
      if (
        nx < 0 ||
        nz < 0 ||
        nx >= w ||
        nz >= h ||
        blocked(nx, nz) ||
        segmentBlocked(
          { x: x * step, z: z * step },
          { x: nx * step, z: nz * step },
        ) ||
        previous.has(k)
      )
        continue;
      previous.set(k, current);
      queue.push(k);
    }
  }
  if (!previous.has(endKey))
    throw new Error("No modeled walking route remains");
  const path: Point[] = [];
  let current = endKey;
  while (current !== -1) {
    path.push({ x: (current % w) * step, z: Math.floor(current / w) * step });
    current = previous.get(current)!;
  }
  path.reverse();
  if (path[0]!.x !== draft.entrance.x || path[0]!.z !== draft.entrance.z)
    path.unshift({ ...draft.entrance });
  if (
    path.at(-1)!.x !== draft.servicePoint.x ||
    path.at(-1)!.z !== draft.servicePoint.z
  )
    path.push({ ...draft.servicePoint });
  return path;
}
export const pathLength = (points: Point[]) =>
  points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.z - points[i]!.z),
      0,
    );
