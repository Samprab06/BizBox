import type { Road } from "@/components/simulator/road-tiles";
export type GeoPoint = [number, number];
export type StreetRoute = { id: string; points: GeoPoint[] };
export function roadTileAt(longitude: number, latitude: number) {
  const size = 2 ** 14,
    lat =
      (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180;
  return {
    x: ((Math.floor(((longitude + 180) / 360) * size) % size) + size) % size,
    y: Math.max(
      0,
      Math.min(
        size - 1,
        Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * size),
      ),
    ),
  };
}
function distance(a: GeoPoint, b: GeoPoint) {
  return Math.hypot(
    (a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180),
    a[1] - b[1],
  );
}
/** Stitch only shared source vertices; never bridge across buildings or infer
 * an entrance. Bounded neighborhood search, prepared once per road response. */
function connectedRoutes(
  roads: readonly Road[],
  center: GeoPoint,
): StreetRoute[] {
  const nodes = new Map<string, { point: GeoPoint; next: Set<string> }>();
  for (const road of roads) {
    if (["motorway", "trunk"].includes(road.roadClass)) continue;
    let previous: string | undefined;
    for (let i = 0; i < road.points.length - 1; i += 2) {
      const point: GeoPoint = [road.points[i], road.points[i + 1]];
      if (!point.every(Number.isFinite)) {
        previous = undefined;
        continue;
      }
      const key = point.map((v) => v.toFixed(6)).join(",");
      if (!nodes.has(key)) nodes.set(key, { point, next: new Set() });
      if (previous && previous !== key) {
        nodes.get(previous)!.next.add(key);
        nodes.get(key)!.next.add(previous);
      }
      previous = key;
    }
  }
  let root: string | undefined,
    nearest = Infinity;
  for (const [key, node] of nodes) {
    const d = distance(node.point, center);
    if (d < nearest) {
      nearest = d;
      root = key;
    }
  }
  if (!root || nearest > 0.004) return [];
  const queue = [root],
    parent = new Map<string, string | undefined>([[root, undefined]]),
    buckets = new Map<number, string>();
  for (let i = 0; i < queue.length && i < 3000; i++) {
    const key = queue[i],
      node = nodes.get(key)!,
      d = distance(node.point, center);
    if (d > 0.014) continue;
    if (d >= 0.0035) {
      const angle = Math.atan2(
        node.point[1] - center[1],
        (node.point[0] - center[0]) * Math.cos((center[1] * Math.PI) / 180),
      );
      const bucket = Math.floor((angle + Math.PI) / (Math.PI / 4)) % 8;
      const prev = buckets.get(bucket);
      if (!prev || distance(nodes.get(prev)!.point, center) < d)
        buckets.set(bucket, key);
    }
    for (const next of node.next)
      if (!parent.has(next)) {
        parent.set(next, key);
        queue.push(next);
      }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 6)
    .map(([bucket, start]) => {
      const points: GeoPoint[] = [];
      let key: string | undefined = start;
      while (key && points.length < 200) {
        points.push(nodes.get(key)!.point);
        key = parent.get(key);
      }
      return { id: `street-${bucket}`, points };
    })
    .filter((r) => r.points.length > 1);
}
export function streetRoutes(
  roads: readonly Road[],
  site: { longitude: number; latitude: number },
): StreetRoute[] {
  const center: GeoPoint = [site.longitude, site.latitude];
  const connected = connectedRoutes(roads, center);
  if (connected.length) return connected;
  const usedRoads = new Set<string>();
  return roads
    .filter((r) => !["motorway", "trunk"].includes(r.roadClass))
    .map((r) => {
      const points: GeoPoint[] = [];
      for (let i = 0; i < r.points.length - 1; i += 2) {
        const p: GeoPoint = [r.points[i], r.points[i + 1]];
        if (p.every(Number.isFinite)) points.push(p);
      }
      const nearest = points.reduce(
        (best, p, i) =>
          distance(p, center) < distance(points[best], center) ? i : best,
        0,
      );
      return {
        id: String(r.seed) + ":" + points[0]?.join(","),
        points: points.slice(Math.max(0, nearest - 12), nearest + 13),
        near: points.length ? distance(points[nearest], center) : Infinity,
      };
    })
    .filter(
      (r) =>
        r.points.length >= 2 &&
        r.near < 0.012 &&
        r.points.some((p) => distance(p, r.points[0]) > 0.003),
    )
    .sort((a, b) => a.near - b.near)
    .filter((route) => {
      const id = route.id.split(":")[0];
      if (usedRoads.has(id)) return false;
      usedRoads.add(id);
      return true;
    })
    .slice(0, 6)
    .map(({ id, points }) => ({ id, points }));
}
export function positionOnStreet(route: StreetRoute, input: number): GeoPoint {
  if (route.points.length < 2) return route.points[0] ?? [0, 0];
  const lengths = route.points
    .slice(1)
    .map((p, i) => distance(p, route.points[i]));
  let remaining =
    Math.max(0, Math.min(1, input)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? remaining / lengths[i] : 0,
        a = route.points[i],
        b = route.points[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= lengths[i];
  }
  return route.points.at(-1)!;
}
/** Local planar calibration for this fixed, north-up overhead camera. Road samples
 * follow sourced polylines; elevation and entrance routing are not inferred. */
export function screenProjection(
  anchors: readonly {
    longitude: number;
    latitude: number;
    x: number;
    y: number;
  }[],
) {
  const [a, b] = anchors;
  if (
    !a ||
    !b ||
    Math.abs(a.longitude - b.longitude) < 1e-6 ||
    Math.abs(a.latitude - b.latitude) < 1e-6
  )
    return null;
  const x = (b.x - a.x) / (b.longitude - a.longitude),
    y = (b.y - a.y) / (b.latitude - a.latitude);
  return (p: GeoPoint) => ({
    x: a.x + (p[0] - a.longitude) * x,
    y: a.y + (p[1] - a.latitude) * y,
  });
}
