import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  SCENE_MAX_COMPETITORS,
  SCENE_MAX_NEARBY_PROPERTIES,
  SCENE_MAX_TENANTS_PER_PROPERTY,
  SceneResponseSchema,
} from "../contracts/scene";
import {
  SceneDataUnavailableError,
  SceneNotFoundError,
  readScene,
} from "./scene-repository";

const query = { radiusMeters: 1000, ringMeters: [] as number[] };
const parent = {
  id: "123",
  city: "Houston",
  property_type: "GeneralRetail",
  property_subtype: "GeneralRetail_Storefront",
  retail: true,
  longitude: -95.4,
  latitude: 29.7,
  dataset: "commercial-property",
  building_name: "Synthetic Plaza",
  primary_address: {
    streetNumber: "1",
    streetName: "Synthetic",
    streetType: "Way",
  },
  stories: 3,
};
const space = {
  id: "123:456",
  listing_id: "123",
  property_id: "123",
  size_sq_ft: 900,
  dataset: "commercial-listing-summary",
  rent_low: "25",
  rent_high: "30",
};
const square = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [-95.41, 29.69],
      [-95.39, 29.69],
      [-95.39, 29.71],
      [-95.41, 29.71],
      [-95.41, 29.69],
    ],
  ],
});

/** Responses in call order: [space,] parent, nearby, competitors, block groups, sources, tenants. */
function database(responses: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (statement: SQL) => {
    calls.push(new PgDialect().sqlToQuery(statement));
    return responses.shift() ?? [];
  });
  return { execute, calls };
}
const sources = [
  {
    places_dataset: "Overture Maps places",
    places_vintage: "2026-10-21.0",
    bg_dataset: "ACS 5-year detailed tables (Summary File)",
    bg_vintage: "2024",
  },
];

describe("readScene", () => {
  it("maps rows to a contract-valid scene with only authorized fields", async () => {
    const db = database([
      [space],
      [parent],
      [
        {
          id: "124",
          property_type: "Multifamily",
          property_subtype: null,
          retail: false,
          longitude: -95.401,
          latitude: 29.701,
          distance: 150.26,
          stories: 12.4,
        },
      ],
      [
        {
          id: "p1",
          name: " Synthetic Cafe ",
          category: "coffee",
          longitude: -95.399,
          latitude: 29.699,
          distance: 140.04,
        },
      ],
      [
        {
          geoid: "000000000001",
          population: 1200,
          median_household_income: -666666666,
          geometry: square,
        },
      ],
      sources,
      [
        {
          property_id: "123",
          name: "Synthetic Tenant",
          industry: "PersonalServices",
        },
        { property_id: "124", name: null, industry: "Unknown" },
      ],
    ]);
    const scene = await readScene(db, "123:456", query, "default");
    expect(SceneResponseSchema.parse(scene)).toBeTruthy();
    expect(scene.suite?.sizeSqFt).toMatchObject({
      value: 900,
      origin: "costar",
    });
    expect(scene.suite?.askingRentUsdPerSfYear.high.value).toBe(30);
    expect(scene.parentProperty).toMatchObject({
      name: "Synthetic Plaza",
      address: "1 Synthetic Way",
      stories: 3,
      tenantCount: 1,
    });
    expect(scene.nearbyProperties[0]).toMatchObject({
      id: "124",
      stories: 12,
      distanceMeters: 150.3,
      tenants: [{ name: null, industry: "Unknown" }],
    });
    expect(scene.competitors[0]).toMatchObject({
      name: "Synthetic Cafe",
      distanceMeters: 140,
    });
    expect(scene.blockGroups[0]).toMatchObject({
      population: 1200,
      medianHouseholdIncome: null,
    });
    expect(scene.rings.map((r) => r.radiusMeters)).toEqual([1000]);
    expect(
      scene.provenance.find((p) => p.layer === "competitors")?.vintage,
    ).toBe("2026-10-21.0");
  });

  it("selects bounded projections with geography ST_DWithin and no raw payloads", async () => {
    const db = database([[parent], [], [], [], sources, []]);
    await readScene(
      db,
      "123",
      { radiusMeters: 1609, ringMeters: [] },
      "founder",
    );
    const text = db.calls.map((c) => c.sql).join("\n");
    expect(text).not.toMatch(/SELECT\s+\*/i);
    expect(text).not.toMatch(/\bp\.data\s*,|\bp\.source\s*,|\bs\.data\s*,/);
    expect(text).not.toMatch(/provenance|decodedEnums|company/);
    const spatial = db.calls.filter((c) => c.sql.includes("ST_DWithin"));
    expect(spatial).toHaveLength(3);
    for (const call of spatial) {
      expect(call.sql).toMatch(/::geography/);
      expect(call.params).toContain(1609);
    }
    expect(text).toContain("LEFT JOIN costar_property_search");
    // Radius and site are bound parameters, never interpolated.
    expect(text).not.toContain("1609");
  });

  it("serves a property site with no suite and extra inner rings sorted", async () => {
    const db = database([[parent], [], [], [], sources, []]);
    const scene = await readScene(
      db,
      "123",
      { radiusMeters: 1000, ringMeters: [800, 400] },
      "default",
    );
    expect(scene.suite).toBeNull();
    expect(scene.rings.map((r) => [r.kind, r.radiusMeters])).toEqual([
      ["inner", 400],
      ["inner", 800],
      ["catchment", 1000],
    ]);
    expect(scene.nearbyProperties).toEqual([]);
    expect(scene.competitors).toEqual([]);
    expect(scene.blockGroups).toEqual([]);
    // No nearby rows still asks for the parent's tenants only.
    expect(db.calls.at(-1)?.params).toEqual(["123"]);
  });

  it("marks unknown suite size and rent explicitly", async () => {
    const db = database([
      [{ ...space, size_sq_ft: null, rent_low: null, rent_high: "0" }],
      [parent],
      [],
      [],
      [],
      sources,
      [],
    ]);
    const scene = await readScene(db, "123:456", query, "default");
    expect(scene.suite?.sizeSqFt.value).toBeNull();
    expect(scene.suite?.sizeSqFt.unknownReason).toBeTruthy();
    expect(scene.suite?.askingRentUsdPerSfYear.low.value).toBeNull();
    expect(scene.suite?.askingRentUsdPerSfYear.high.value).toBeNull();
    expect(SceneResponseSchema.parse(scene)).toBeTruthy();
  });

  it("caps rows and reports truncation, nearest first", async () => {
    const properties = Array.from(
      { length: SCENE_MAX_NEARBY_PROPERTIES + 1 },
      (_, i) => ({
        id: `n${i}`,
        property_type: null,
        property_subtype: null,
        retail: false,
        longitude: -95.4,
        latitude: 29.7,
        distance: i,
        stories: null,
      }),
    );
    const places = Array.from(
      { length: SCENE_MAX_COMPETITORS + 1 },
      (_, i) => ({
        id: `c${i}`,
        name: null,
        category: "coffee",
        longitude: -95.4,
        latitude: 29.7,
        distance: i,
      }),
    );
    const tenants = Array.from(
      { length: SCENE_MAX_TENANTS_PER_PROPERTY + 5 },
      (_, i) => ({ property_id: "123", name: `T${i}`, industry: null }),
    );
    const db = database([[parent], properties, places, [], sources, tenants]);
    const scene = await readScene(db, "123", query, "default");
    expect(scene.nearbyProperties).toHaveLength(SCENE_MAX_NEARBY_PROPERTIES);
    expect(scene.competitors).toHaveLength(SCENE_MAX_COMPETITORS);
    expect(scene.truncated).toEqual({
      nearbyProperties: true,
      competitors: true,
    });
    expect(scene.parentProperty.tenants).toHaveLength(
      SCENE_MAX_TENANTS_PER_PROPERTY,
    );
    expect(scene.parentProperty.tenantCount).toBe(
      SCENE_MAX_TENANTS_PER_PROPERTY + 5,
    );
  });

  it("raises not-found for unknown sites and suites", async () => {
    await expect(
      readScene(database([[]]), "123", query, "default"),
    ).rejects.toBeInstanceOf(SceneNotFoundError);
    await expect(
      readScene(database([[]]), "123:456", query, "default"),
    ).rejects.toBeInstanceOf(SceneNotFoundError);
    // A suite in a building outside the kit has no point to anchor a scene.
    await expect(
      readScene(database([[space], []]), "123:456", query, "default"),
    ).rejects.toBeInstanceOf(SceneNotFoundError);
    await expect(
      readScene(database([]), "abc", query, "default"),
    ).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  it("reports unavailable geography and malformed driver output", async () => {
    await expect(
      readScene(
        database([[{ ...parent, longitude: null }]]),
        "123",
        query,
        "default",
      ),
    ).rejects.toBeInstanceOf(SceneDataUnavailableError);
    await expect(
      readScene(
        database([
          [parent],
          [],
          [],
          [{ geoid: "1", geometry: "{" }],
          sources,
          [],
        ]),
        "123",
        query,
        "default",
      ),
    ).rejects.toBeInstanceOf(SceneDataUnavailableError);
  });
});
