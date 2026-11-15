import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { prepareCandidateMapStyle } from "./map-style";

// Exercise the exact compiler used by the installed renderer, without a WebGL context.
const require = createRequire(import.meta.url);
const rendererRequire = createRequire(require.resolve("maplibre-gl"));
const { featureFilter, createExpression } = rendererRequire(
  "@maplibre/maplibre-gl-style-spec",
) as {
  createExpression: (
    expression: unknown,
    property: { type: "number"; default: number },
  ) => {
    result: string;
    value: {
      evaluate: (
        globals: { zoom: number },
        feature: { type: number; properties: Record<string, unknown> },
      ) => number;
    };
  };
  featureFilter: (filter: unknown) => {
    filter: (
      globals: { zoom: number },
      feature: { type: number; properties: Record<string, unknown> },
    ) => boolean;
  };
};

const fixture = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "highway-shield-non-us",
      type: "line",
      source: "roads",
      filter: [
        "all",
        ["<=", ["get", "ref_length"], 6],
        ["==", ["get", "network"], "regional"],
      ],
    },
    {
      id: "poi_r7",
      type: "circle",
      source: "pois",
      filter: ["all", [">=", ["get", "rank"], 7], ["<", ["get", "rank"], 20]],
    },
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: "buildings",
      paint: {
        "fill-extrusion-base": ["get", "render_min_height"],
        "fill-extrusion-height": ["get", "render_height"],
      },
    },
  ],
});

describe("candidate basemap numeric boundary", () => {
  it("excludes unknown ranks and shield lengths without numeric warnings, preserving valid filters", () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const prepared = prepareCandidateMapStyle(fixture());
      const [shieldLayer, poiLayer] = prepared.layers;
      if (!("filter" in shieldLayer) || !("filter" in poiLayer))
        throw new Error("Fixture filters missing");
      const shield = featureFilter(shieldLayer.filter);
      const poi = featureFilter(poiLayer.filter);
      for (const value of [null, undefined, "5"]) {
        expect(
          shield.filter(
            { zoom: 12 },
            { type: 2, properties: { ref_length: value, network: "regional" } },
          ),
        ).toBe(false);
        expect(
          poi.filter({ zoom: 12 }, { type: 1, properties: { rank: value } }),
        ).toBe(false);
      }
      for (const [value, want] of [
        [0, true],
        [5, true],
        [6, true],
        [6.5, false],
      ] as const) {
        expect(
          shield.filter(
            { zoom: 12 },
            { type: 2, properties: { ref_length: value, network: "regional" } },
          ),
        ).toBe(want);
      }
      expect(
        shield.filter(
          { zoom: 12 },
          { type: 2, properties: { ref_length: 5, network: "other" } },
        ),
      ).toBe(false);
      for (const [value, want] of [
        [6, false],
        [7, true],
        [19, true],
        [20, false],
      ] as const) {
        expect(
          poi.filter({ zoom: 12 }, { type: 1, properties: { rank: value } }),
        ).toBe(want);
      }
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      warnings.mockRestore();
    }
  });

  it("preserves known building heights and uses the renderer zero default for unknown heights", () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const building = prepareCandidateMapStyle(fixture()).layers[2];
      if (building.type !== "fill-extrusion")
        throw new Error("Building fixture missing");
      for (const [property, field] of [
        ["fill-extrusion-base", "render_min_height"],
        ["fill-extrusion-height", "render_height"],
      ] as const) {
        const compiled = createExpression(building.paint![property], {
          type: "number",
          default: 0,
        });
        expect(compiled.result).toBe("success");
        for (const [value, want] of [
          [null, 0],
          [undefined, 0],
          ["bad", 0],
          [0, 0],
          [12.5, 12.5],
          [180, 180],
        ] as const) {
          expect(
            compiled.value.evaluate(
              { zoom: 15 },
              { type: 3, properties: { [field]: value } },
            ),
          ).toBe(want);
        }
      }
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      warnings.mockRestore();
    }
  });

  it("keeps original input intact and resource URLs resolvable after object handoff", () => {
    const original = {
      ...fixture(),
      glyphs: "../fonts/{fontstack}/{range}.pbf",
      sprite: "../sprite",
      sources: {
        roads: {
          type: "vector",
          url: "../planet",
          attribution: "Original map attribution",
        },
        absolute: {
          type: "raster",
          tiles: ["https://tiles.example.com/{z}/{x}/{y}.png?token=public"],
        },
        raster: { type: "raster", tiles: ["../tiles/{z}/{x}/{y}.png"] },
        points: { type: "geojson", data: "./points.geojson" },
      },
    } as StyleSpecification;
    const before = structuredClone(original);
    const prepared = prepareCandidateMapStyle(
      original,
      "https://example.com/styles/liberty.json",
    );
    expect(original).toEqual(before);
    expect(prepared.glyphs).toBe(
      "https://example.com/fonts/{fontstack}/{range}.pbf",
    );
    expect(prepared.sprite).toBe("https://example.com/sprite");
    expect(
      prepareCandidateMapStyle(
        { ...original, sprite: [{ id: "main", url: "./icons" }] },
        "https://example.com/styles/liberty.json",
      ).sprite,
    ).toEqual([{ id: "main", url: "https://example.com/styles/icons" }]);
    expect(prepared.sources).toMatchObject({
      roads: {
        url: "https://example.com/planet",
        attribution: "Original map attribution",
      },
      absolute: {
        tiles: ["https://tiles.example.com/{z}/{x}/{y}.png?token=public"],
      },
      raster: { tiles: ["https://example.com/tiles/{z}/{x}/{y}.png"] },
      points: { data: "https://example.com/styles/points.geojson" },
    });
  });
});
