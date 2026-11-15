/**
 * HAC-77: the building under the selected site. The Vexcel mesh is one
 * photogrammetry surface with no per-building features, so the footprint comes
 * from the OpenStreetMap `building` layer in the OpenFreeMap vector tiles the
 * city already loads for roads. No match within a short distance means the
 * city shows the pin only; nothing is invented.
 */
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { Position } from "@/lib/sim/trips";

export const FOOTPRINT_ZOOM = 14;
/** How far from the site point a footprint may be and still count as its building. */
export const MAX_FOOTPRINT_METERS = 25;
export const footprintSource =
  "OpenStreetMap building footprint via OpenFreeMap";

export type Footprint = {
  /** Outer ring first, then holes; [lng, lat] closed or open. */
  rings: Position[][];
  /** OSM render height in meters, when mapped. */
  heightMeters: number | null;
};

export type FootprintMatch = {
  footprint: Footprint;
  match: "contains" | "nearest";
  distanceMeters: number;
};

export function tileFor(
  longitude: number,
  latitude: number,
  zoom = FOOTPRINT_ZOOM,
) {
  const size = 2 ** zoom;
  const lat = (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180;
  return {
    x: Math.floor(((longitude + 180) / 360) * size),
    y: Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * size),
  };
}

export function parseBuildingFootprints(
  buffer: ArrayBuffer,
  x: number,
  y: number,
  zoom = FOOTPRINT_ZOOM,
): Footprint[] {
  const layer = new VectorTile(new Pbf(new Uint8Array(buffer))).layers.building;
  if (!layer) return [];
  const footprints: Footprint[] = [];
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const height = Number(feature.properties.render_height);
    const heightMeters = Number.isFinite(height) && height > 0 ? height : null;
    const { geometry } = feature.toGeoJSON(x, y, zoom);
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    for (const rings of polygons)
      if (rings[0]?.length >= 3)
        footprints.push({
          rings: rings.map((ring) =>
            ring.map(([lng, lat]) => [lng, lat] as const),
          ),
          heightMeters,
        });
  }
  return footprints;
}

/** Local meters around `origin`, adequate at building scale. */
function toMeters(origin: Position) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  return ([lng, lat]: Position) =>
    [(lng - origin[0]) * kx, (lat - origin[1]) * 111_320] as const;
}

function insideRing(
  point: readonly [number, number],
  ring: readonly (readonly [number, number])[],
) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared),
      )
    : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The footprint containing the point, else the nearest within `maxMeters`, else null. */
export function footprintAt(
  footprints: readonly Footprint[],
  point: Position,
  maxMeters = MAX_FOOTPRINT_METERS,
): FootprintMatch | null {
  const local = toMeters(point);
  const origin = [0, 0] as const;
  let best: FootprintMatch | null = null;
  for (const footprint of footprints) {
    const [outer, ...holes] = footprint.rings.map((ring) => ring.map(local));
    if (
      insideRing(origin, outer) &&
      !holes.some((hole) => insideRing(origin, hole))
    )
      return { footprint, match: "contains", distanceMeters: 0 };
    let distance = Infinity;
    for (let i = 0; i < outer.length; i++)
      distance = Math.min(
        distance,
        distanceToSegment(origin, outer[i], outer[(i + 1) % outer.length]),
      );
    if (distance <= maxMeters && (!best || distance < best.distanceMeters))
      best = { footprint, match: "nearest", distanceMeters: distance };
  }
  return best;
}

export async function loadSiteFootprint(
  template: string,
  site: Position,
  signal: AbortSignal,
): Promise<FootprintMatch | null> {
  const { x, y } = tileFor(site[0], site[1]);
  const url = template
    .replace("{z}", String(FOOTPRINT_ZOOM))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Building tile unavailable");
  return footprintAt(
    parseBuildingFootprints(await response.arrayBuffer(), x, y),
    site,
  );
}

/** Height used for footprints without an OSM height in the no-Vexcel fallback. */
export const ASSUMED_BUILDING_METERS = 6;
/** Radius of buildings drawn around the site when there is no Vexcel mesh. */
export const FALLBACK_RADIUS_METERS = 400;

export type FootprintBlock = {
  outer: Position[];
  heightMeters: number;
  heightSource: "osm" | "assumed";
  footprint: Footprint;
};

/**
 * Footprints within `radiusMeters` of the site as blocks to extrude. Heights come
 * from OSM where mapped; otherwise they are marked as assumed.
 */
export function footprintBlocks(
  footprints: readonly Footprint[],
  site: Position,
  radiusMeters = FALLBACK_RADIUS_METERS,
): FootprintBlock[] {
  const local = toMeters(site);
  return footprints.flatMap((footprint) => {
    const outer = footprint.rings[0];
    const near = outer.some((point) => {
      const [x, y] = local(point);
      return Math.hypot(x, y) <= radiusMeters;
    });
    if (!near) return [];
    return [
      {
        outer: [...outer],
        heightMeters: footprint.heightMeters ?? ASSUMED_BUILDING_METERS,
        heightSource: footprint.heightMeters === null ? "assumed" : "osm",
        footprint,
      },
    ];
  });
}

/** Footprints from the 3 × 3 tiles around the site, for the no-Vexcel fallback. */
export async function loadAreaFootprints(
  template: string,
  site: Position,
  signal: AbortSignal,
): Promise<Footprint[]> {
  const { x, y } = tileFor(site[0], site[1]);
  const tiles = [-1, 0, 1].flatMap((dx) =>
    [-1, 0, 1].map((dy) => ({ x: x + dx, y: y + dy })),
  );
  const results = await Promise.all(
    tiles.map(async (tile) => {
      const url = template
        .replace("{z}", String(FOOTPRINT_ZOOM))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("Building tile unavailable");
      return parseBuildingFootprints(
        await response.arrayBuffer(),
        tile.x,
        tile.y,
      );
    }),
  );
  return results.flat();
}
