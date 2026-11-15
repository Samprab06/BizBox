import { describe, expect, it } from "vitest";
import {
  groupListingMarkers,
  markerSiteId,
  overheadFrame,
  listingLabelOffsets,
  listingTileError,
  LISTING_TILE_BUDGET,
  type ListingPoint,
} from "./listing-markers";
import { RENDER_SETTINGS } from "@/components/simulator/render-policy";

// Invented offline fixture, never a location recommendation.
const point = (
  siteId: string,
  longitude = -95.6,
  latitude = 29.7,
): ListingPoint => ({
  siteId,
  propertyId: "building",
  longitude,
  latitude,
  address: "Fixture address",
});
describe("real shortlist marker model", () => {
  it("bounds the regional cache below Detailed while accommodating the verified coarse overview", () => {
    const ceiling =
      LISTING_TILE_BUDGET.cacheBytes +
      LISTING_TILE_BUDGET.maximumCacheOverflowBytes;
    expect(ceiling).toBeGreaterThan(342_127_702); // Settled real-provider overview measured by manager.
    expect(ceiling).toBeLessThan(
      RENDER_SETTINGS.detailed.cacheBytes +
        RENDER_SETTINGS.detailed.maximumCacheOverflowBytes,
    );
    expect(
      RENDER_SETTINGS.balanced.cacheBytes +
        RENDER_SETTINGS.balanced.maximumCacheOverflowBytes,
    ).toBe(192 * 1024 * 1024);
  });
  it("allows empty regional roots to refine without forcing deep overview detail or changing close-up quality", () => {
    expect(
      listingTileError(16, 96, 160_000, 768, Math.PI / 5),
    ).toBeGreaterThanOrEqual(0.25);
    expect(listingTileError(16, 96, 160_000, 768, Math.PI / 5)).toBeLessThan(
      0.741,
    );
    expect(listingTileError(16, 96, 500, 768, Math.PI / 5)).toBe(16);
    expect(listingTileError(16, 96, 160_000, 768, Math.PI / 5)).toBeGreaterThan(
      0.5,
    );
    expect(listingTileError(16, 96, 20_000_000, 768, Math.PI / 5)).toBe(0.25);
    expect(listingTileError(16, 0, 160_000, 768, Math.PI / 5)).toBe(16);
  });
  it("separates close screen labels without changing geographic pin positions", () => {
    const points = [
      { id: "five-units", x: 318, y: 192, width: 112 },
      { id: "neighbor", x: 319, y: 225, width: 34 },
    ];
    const original = structuredClone(points);
    const offsets = listingLabelOffsets(points, {
      left: 40,
      top: 140,
      width: 800,
      height: 220,
    });
    const rects = points.map((point) => {
      const offset = offsets.get(point.id)!;
      return {
        left: point.x + offset.x - point.width / 2,
        right: point.x + offset.x + point.width / 2,
        top: point.y + offset.y - 15,
        bottom: point.y + offset.y + 15,
      };
    });
    expect(points).toEqual(original);
    const [a, b] = rects;
    expect(
      a.left >= b.right ||
        b.left >= a.right ||
        a.top >= b.bottom ||
        b.top >= a.bottom,
    ).toBe(true);
    for (const rect of rects)
      for (const point of points)
        expect(
          rect.left >= point.x + 16 ||
            rect.right <= point.x - 16 ||
            rect.top >= point.y + 16 ||
            rect.bottom <= point.y - 16,
        ).toBe(true);
  });
  it("keeps exact coincident units together, their source IDs and stable shortlist order", () => {
    const groups = groupListingMarkers([
      point("a"),
      point("b"),
      { ...point("c"), propertyId: "other-record" },
      point("d", -95.1),
      point("a"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      index: 1,
      longitude: -95.6,
      latitude: 29.7,
    });
    expect(groups[0].members.map((member) => member.siteId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(groups[1].index).toBe(2);
    expect(markerSiteId(groups[0], "b")).toBe("b");
    expect(markerSiteId(groups[0], "d")).toBe("a");
  });
  it("never jitters nearby points, and omits missing, nonfinite or invalid coordinates", () => {
    const groups = groupListingMarkers([
      point("a"),
      point("b", -95.600001),
      { ...point("missing"), longitude: null },
      point("nan", NaN),
      point("latitude", 0, 91),
      point("longitude", 181),
      point("zero", 0, 0),
    ]);
    expect(groups.map((group) => group.members[0].siteId)).toEqual([
      "a",
      "b",
      "zero",
    ]);
    expect(groups[1].longitude).toBe(-95.600001);
  });
  it("fits regional points inside the unobscured left viewport, including outside mesh coverage", () => {
    const markers = groupListingMarkers([
      point("west", -95.65, 29.73),
      point("east", -95.14, 29.59),
      point("middle", -95.48, 29.7),
    ]);
    const viewport = { left: 40, top: 105, width: 780, height: 235 };
    const canvas = { width: 1366, height: 800 };
    const target = overheadFrame(markers, canvas, viewport, Math.PI / 3)!;
    const metersPerPixel =
      (2 * target.height * Math.tan(Math.PI / 6)) / canvas.height;
    for (const marker of markers) {
      const x =
        canvas.width / 2 +
        ((marker.longitude - target.longitude) *
          111_320 *
          Math.cos((29.66 * Math.PI) / 180)) /
          metersPerPixel;
      const y =
        canvas.height / 2 -
        ((marker.latitude - target.latitude) * 111_320) / metersPerPixel;
      expect(x).toBeGreaterThan(viewport.left);
      expect(x).toBeLessThan(viewport.left + viewport.width);
      expect(y).toBeGreaterThan(viewport.top);
      expect(y).toBeLessThan(viewport.top + viewport.height);
    }
    expect(overheadFrame([], canvas, viewport, Math.PI / 3)).toBeNull();
  });
});
