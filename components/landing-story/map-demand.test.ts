import { describe, it, expect } from "vitest";
import {
  roadTileAt,
  streetRoutes,
  positionOnStreet,
  screenProjection,
} from "./map-demand";
describe("visible street-aligned demand samples", () => {
  it("joins shared road vertices into multi-block paths without cutting corners", () => {
    const routes = streetRoutes(
      [
        {
          seed: 1,
          roadClass: "residential",
          points: [0, 0, 0, 0.002, 0, 0.004],
        },
        {
          seed: 2,
          roadClass: "residential",
          points: [0, 0.004, 0.002, 0.004, 0.004, 0.004],
        },
      ],
      { longitude: 0, latitude: 0 },
    );
    const joined = routes.find((r) => r.points.some((p) => p[0] === 0.004));
    expect(joined?.points).toEqual([
      [0.004, 0.004],
      [0.002, 0.004],
      [0, 0.004],
      [0, 0.002],
      [0, 0],
    ]);
  });
  it("uses source road vertices and ignores distant roads", () => {
    const routes = streetRoutes(
      [
        {
          roadClass: "residential",
          seed: 1,
          points: [-95.391, 29.74, -95.391, 29.742, -95.391, 29.744],
        },
        { roadClass: "residential", seed: 2, points: [-90, 32, -90, 32.01] },
      ],
      { longitude: -95.391, latitude: 29.7426 },
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].points).toEqual([
      [-95.391, 29.74],
      [-95.391, 29.742],
      [-95.391, 29.744],
    ]);
    const middle = positionOnStreet(routes[0], 0.5);
    expect(middle[0]).toBeCloseTo(-95.391, 10);
    expect(middle[1]).toBeCloseTo(29.742, 10);
    expect(positionOnStreet(routes[0], 0)).toEqual([-95.391, 29.74]);
    expect(positionOnStreet(routes[0], 1)).toEqual([-95.391, 29.744]);
  });
  it("interpolates by distance without cutting corners", () => {
    const route = {
      id: "bend",
      points: [
        [0, 0],
        [0, 0.001],
        [0.002, 0.001],
      ] as [number, number][],
    };
    const p = positionOnStreet(route, 0.5);
    expect(p[1]).toBe(0.001);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(0.002);
  });
  it("calibrates the fixed north-up map to both actual projected pins", () => {
    const project = screenProjection([
      { longitude: 0, latitude: 0, x: 100, y: 400 },
      { longitude: 2, latitude: 4, x: 300, y: 0 },
    ]);
    expect(project?.([1, 2])).toEqual({ x: 200, y: 200 });
    expect(
      screenProjection([{ longitude: 0, latitude: 0, x: 0, y: 0 }]),
    ).toBeNull();
    expect(roadTileAt(0, 0)).toEqual({ x: 8192, y: 8192 });
  });
});
