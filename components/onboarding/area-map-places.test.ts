import { describe, expect, it } from "vitest";
import { areaMapPlaces } from "./area-map-places";
import { cityViews } from "./area-map-data";

describe("curated neighborhood map anchors", () => {
  for (const city of ["Houston", "Los Angeles"] as const) {
    it(`keeps ${city} labels sparse, unique and geographically local`, () => {
      const places = areaMapPlaces[city];
      expect(places.length).toBeGreaterThanOrEqual(6);
      expect(places.length).toBeLessThanOrEqual(9);
      expect(new Set(places.map((place) => place.name)).size).toBe(
        places.length,
      );
      for (const {
        coordinates: [longitude, latitude],
      } of places) {
        expect(Math.abs(longitude - cityViews[city].longitude)).toBeLessThan(
          0.2,
        );
        expect(Math.abs(latitude - cityViews[city].latitude)).toBeLessThan(
          0.15,
        );
      }
    });
  }
});
