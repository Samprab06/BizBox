import { describe, expect, it, vi } from "vitest";
import { SceneResponseSchema, type SceneResponse } from "@/lib/contracts/scene";
import {
  SceneDataUnavailableError,
  SceneNotFoundError,
  circleRing,
  type getScene,
} from "@/lib/data/scene-repository";
import { SCENE_CACHE_CONTROL, createSceneHandler } from "./handler";

const context = (siteId = "123:456") => ({
  params: Promise.resolve({ siteId }),
});
const request = (query = "") =>
  new Request(`http://localhost/api/sites/123/scene${query}`);

const center = { longitude: -95.4, latitude: 29.7 };
const square: [number, number][] = [
  [-95.41, 29.69],
  [-95.39, 29.69],
  [-95.39, 29.71],
  [-95.41, 29.71],
  [-95.41, 29.69],
];
/** Synthetic scene: invented IDs, names and places only. */
function syntheticScene(overrides: Partial<SceneResponse> = {}): SceneResponse {
  return {
    siteId: "123:456",
    radiusMeters: 1000,
    radiusOrigin: "default",
    site: { propertyId: "123", city: "Houston", point: center },
    suite: {
      id: "123:456",
      listingId: "123",
      sizeSqFt: {
        value: 1200,
        unit: "SF",
        origin: "costar",
        evidenceIds: ["scene:suite"],
      },
      askingRentUsdPerSfYear: {
        low: {
          value: 30,
          unit: "USD/SF/year",
          origin: "costar",
          evidenceIds: ["scene:suite"],
        },
        high: {
          value: null,
          unit: "USD/SF/year",
          origin: "costar",
          evidenceIds: ["scene:suite"],
          unknownReason: "CoStar has no asking rent for this suite",
        },
      },
    },
    parentProperty: {
      id: "123",
      name: "Synthetic Plaza",
      address: "1 Synthetic Way",
      city: "Houston",
      point: center,
      propertyType: "GeneralRetail",
      propertySubtype: "GeneralRetail_Storefront",
      retail: true,
      stories: 2,
      tenants: [{ name: "Synthetic Tenant", industry: "PersonalServices" }],
      tenantCount: 1,
    },
    nearbyProperties: [
      {
        id: "124",
        point: { longitude: -95.401, latitude: 29.701 },
        propertyType: "Multifamily",
        propertySubtype: null,
        retail: false,
        stories: null,
        tenants: [],
        tenantCount: 0,
        distanceMeters: 150.3,
      },
    ],
    competitors: [
      {
        id: "p1",
        name: "Synthetic Cafe",
        category: "coffee",
        point: { longitude: -95.399, latitude: 29.699 },
        distanceMeters: 140.2,
      },
    ],
    blockGroups: [
      {
        geoid: "000000000001",
        population: 1200,
        medianHouseholdIncome: null,
        geometry: { type: "Polygon", coordinates: [square] },
      },
    ],
    rings: [
      {
        kind: "catchment",
        radiusMeters: 1000,
        origin: "default",
        ring: circleRing(center, 1000),
      },
    ],
    truncated: { nearbyProperties: false, competitors: false },
    provenance: [
      {
        id: "scene:suite",
        layer: "suite",
        origin: "costar",
        dataset: "commercial-listing-summary",
        vintage: null,
        description: "Synthetic suite",
        limitations: [],
      },
      {
        id: "scene:rings",
        layer: "rings",
        origin: "default",
        dataset: "Geodesic circle",
        vintage: null,
        description: "Default radius",
        limitations: [],
      },
    ],
    ...overrides,
  };
}
const getterReturning = (scene: unknown) =>
  vi.fn(async () => scene) as unknown as typeof getScene;
const keysOf = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
  else if (value && typeof value === "object")
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      keysOf(entry, found);
    }
  return found;
};

describe("scene route boundary", () => {
  it("returns a cacheable scene that passes the contract", async () => {
    const getter = getterReturning(syntheticScene());
    const response = await createSceneHandler(getter)(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(SCENE_CACHE_CONTROL);
    expect(SCENE_CACHE_CONTROL).toMatch(/public.*s-maxage/);
    const body = await response.json();
    expect(SceneResponseSchema.safeParse(body).success).toBe(true);
    expect(getter).toHaveBeenCalledWith(
      "123:456",
      { radiusMeters: 1000, ringMeters: [] },
      "default",
    );
  });

  it("contains no raw CoStar data or source keys", async () => {
    const response = await createSceneHandler(
      getterReturning(syntheticScene()),
    )(request(), context());
    const keys = keysOf(await response.json());
    for (const forbidden of [
      "data",
      "source",
      "decodedEnums",
      "primaryAddress",
    ])
      expect(keys.has(forbidden)).toBe(false);
  });

  it("refuses to serve a payload carrying a raw source field", async () => {
    const scene = syntheticScene();
    const leaky = {
      ...scene,
      parentProperty: {
        ...scene.parentProperty,
        data: { secret: "raw costar payload" },
      },
      nearbyProperties: [
        { ...scene.nearbyProperties[0], source: { recordId: "x" } },
      ],
    };
    const response = await createSceneHandler(getterReturning(leaky))(
      request(),
      context(),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("raw costar");
  });

  it("returns empty arrays for an empty area", async () => {
    const empty = syntheticScene({
      nearbyProperties: [],
      competitors: [],
      blockGroups: [],
    });
    const response = await createSceneHandler(getterReturning(empty))(
      request(),
      context(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nearbyProperties).toEqual([]);
    expect(body.competitors).toEqual([]);
    expect(body.blockGroups).toEqual([]);
  });

  it("passes caller radii as founder input", async () => {
    const getter = getterReturning(syntheticScene());
    await createSceneHandler(getter)(
      request("?radiusMeters=1609&ringMeters=400,800"),
      context(),
    );
    expect(getter).toHaveBeenCalledWith(
      "123:456",
      { radiusMeters: 1609, ringMeters: [400, 800] },
      "founder",
    );
  });

  it("maps a missing site to 404 without caching", async () => {
    const getter = vi.fn(async () => {
      throw new SceneNotFoundError("Site not found");
    }) as unknown as typeof getScene;
    const response = await createSceneHandler(getter)(request(), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sanitizes unavailable data and driver errors", async () => {
    for (const error of [
      new SceneDataUnavailableError("table detail"),
      new Error("postgres://user:pw@host/db failed"),
    ]) {
      const getter = vi.fn(async () => {
        throw error;
      }) as unknown as typeof getScene;
      const response = await createSceneHandler(getter)(request(), context());
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toMatch(
        /postgres|table detail/,
      );
    }
  });

  it.each([
    ["site id", "abc", ""],
    ["encoded slash", "1%2F2", ""],
    ["bad escape", "%E0%A4%A", ""],
    ["radius too small", "123", "?radiusMeters=5"],
    ["radius too large", "123", "?radiusMeters=50000"],
    ["unknown param", "123", "?projectId=x"],
    ["ring outside radius", "123", "?radiusMeters=500&ringMeters=900"],
    ["repeated param", "123", "?radiusMeters=500&radiusMeters=600"],
  ])("rejects an invalid %s with 400", async (_name, siteId, query) => {
    const getter = getterReturning(syntheticScene());
    const response = await createSceneHandler(getter)(
      request(query),
      context(siteId),
    );
    expect(response.status).toBe(400);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("circleRing", () => {
  it("is a closed ring whose points sit at the requested distance", () => {
    const ring = circleRing(center, 1000);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring).toHaveLength(65);
    for (const [lng, lat] of ring) {
      const dLat = ((lat - center.latitude) * Math.PI) / 180;
      const dLng = ((lng - center.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((center.latitude * Math.PI) / 180) *
          Math.cos((lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const meters = 2 * 6371008.8 * Math.asin(Math.sqrt(a));
      expect(meters).toBeGreaterThan(995);
      expect(meters).toBeLessThan(1005);
    }
  });
});
