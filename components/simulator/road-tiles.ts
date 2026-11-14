import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { Camera } from "cesium";

const zoom = 14;
const size = 2 ** zoom;
const roadClasses = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "residential",
  "service",
]);

export type Road = { roadClass: string; points: number[]; seed: number };

export function nearbyRoadTiles(
  camera: Camera,
  center?: { longitude: number; latitude: number },
) {
  const location = center ?? camera.positionCartographic;
  const lon = location.longitude;
  const lat = Math.max(-1.484, Math.min(1.484, location.latitude));
  const x = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * size);
  const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * size);
  const tiles: { x: number; y: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (y + dy >= 0 && y + dy < size) {
        tiles.push({ x: (x + dx + size) % size, y: y + dy });
      }
    }
  }
  return tiles;
}

export async function getRoadTemplate(signal: AbortSignal) {
  const response = await fetch("https://tiles.openfreemap.org/planet", {
    signal,
  });
  if (!response.ok) throw new Error("Road tiles unavailable");
  const metadata = await response.json();
  const template = metadata.tiles?.[0];
  if (typeof template !== "string")
    throw new Error("Missing road tile template");
  return template;
}

export async function loadRoadTile(
  template: string,
  x: number,
  y: number,
  signal: AbortSignal,
) {
  const url = template
    .replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Road tile unavailable");
  const layer = new VectorTile(
    new Pbf(new Uint8Array(await response.arrayBuffer())),
  ).layers.transportation;
  const roads: Road[] = [];
  if (!layer) return roads;
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const roadClass = String(feature.properties.class);
    if (!roadClasses.has(roadClass) || feature.properties.brunnel === "tunnel")
      continue;
    const { geometry } = feature.toGeoJSON(x, y, zoom);
    const lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    const seed = feature.id ?? x + y + index;
    for (const line of lines) {
      if (line.length > 1) roads.push({ roadClass, points: line.flat(), seed });
    }
  }
  return roads;
}
