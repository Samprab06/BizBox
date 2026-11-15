import type { City } from "./flow";

export type Brush = "favor" | "avoid";
export type Mark = { lng: number; lat: number; brush: Brush };
export const mapMarker = "\n[BizBox area map v1] ";
export type Rectangle = {
  bounds: [number, number, number, number];
  brush: Brush;
};
export const cityViews: Record<
  City,
  { longitude: number; latitude: number; zoom: number }
> = {
  Houston: { longitude: -95.3698, latitude: 29.7604, zoom: 10.3 },
  "Los Angeles": { longitude: -118.34, latitude: 34.045, zoom: 10.1 },
};

export function readAreaMap(
  value: string,
  city: City,
): { marks: Mark[]; rectangles: Rectangle[]; previous: string } {
  const [previous, encoded] = value.split(mapMarker);
  if (!encoded) {
    // A damaged/older marker must not survive Reset or get nested into a new map.
    const start = value.indexOf("[BizBox area map");
    return {
      previous: start < 0 ? value : value.slice(0, start).trimEnd(),
      marks: [],
      rectangles: [],
    };
  }
  try {
    const data = JSON.parse(encoded);
    if (data.city !== city || !Array.isArray(data.marks))
      return { previous: "", marks: [], rectangles: [] };
    const marks: Mark[] = data.marks.filter(
      (m: Mark) =>
        m &&
        Number.isFinite(m.lng) &&
        Number.isFinite(m.lat) &&
        Math.abs(m.lng) <= 180 &&
        Math.abs(m.lat) < 85 &&
        (m.brush === "favor" || m.brush === "avoid"),
    );
    return {
      previous: data.previous === undefined ? previous : String(data.previous),
      marks,
      rectangles: Array.isArray(data.rectangles)
        ? data.rectangles
            .filter(
              (r: unknown) =>
                Array.isArray(r) &&
                r.length === 5 &&
                r.slice(0, 4).every(Number.isFinite) &&
                Math.abs(r[0]) <= 180 &&
                Math.abs(r[2]) <= 180 &&
                Math.abs(r[1]) < 85 &&
                Math.abs(r[3]) < 85 &&
                r[0] < r[2] &&
                r[1] < r[3] &&
                (r[4] === 0 || r[4] === 1),
            )
            .map((r: number[]) => ({
              bounds: r.slice(0, 4),
              brush: r[4] === 0 ? "favor" : "avoid",
            }))
        : [],
    };
  } catch {
    return { previous, marks: [], rectangles: [] };
  }
}

export function writeAreaMap(
  marks: Mark[],
  city: City,
  previous: string,
  rectangles: Rectangle[] = [],
): string {
  if (!marks.length && !rectangles.length) return previous;
  const bounded = [...marks, ...rectangles];
  const summary = [
    previous,
    bounded.some((m) => m.brush === "favor") &&
      `Favor green-selected areas in ${city}`,
    bounded.some((m) => m.brush === "avoid") &&
      `Avoid red-selected areas in ${city}`,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    summary +
    mapMarker +
    JSON.stringify({
      city,
      previous,
      marks,
      rectangles: rectangles.map((r) => [
        ...r.bounds,
        r.brush === "favor" ? 0 : 1,
      ]),
    })
  );
}

export function areaMapSummary(value: string): string {
  return value.split(mapMarker)[0];
}

export function areaMapMatchesCity(value: string, city: City): boolean {
  const encoded = value.split(mapMarker)[1];
  if (!encoded) return true;
  try {
    return JSON.parse(encoded).city === city;
  } catch {
    return true;
  }
}
