import { describe, expect, it } from "vitest";
import { footprintAt, tileFor, type Footprint } from "./building-footprint";

const site = [-95.3914, 29.7458] as const;
const metersToLng = (m: number) =>
  m / (111_320 * Math.cos((site[1] * Math.PI) / 180));
const metersToLat = (m: number) => m / 111_320;
/** A square footprint centred `east`/`north` meters from the site, `half` meters across half-width. */
const square = (
  east: number,
  north: number,
  half: number,
  height: number | null = 8,
): Footprint => {
  const [cx, cy] = [site[0] + metersToLng(east), site[1] + metersToLat(north)];
  const [dx, dy] = [metersToLng(half), metersToLat(half)];
  return {
    rings: [
      [
        [cx - dx, cy - dy],
        [cx + dx, cy - dy],
        [cx + dx, cy + dy],
        [cx - dx, cy + dy],
      ],
    ],
    heightMeters: height,
  };
};

describe("footprintAt", () => {
  it("picks the building that contains the site point", () => {
    const under = square(0, 0, 10);
    const result = footprintAt([square(40, 0, 10), under], site);
    expect(result?.match).toBe("contains");
    expect(result?.footprint).toBe(under);
  });

  it("falls back to the nearest footprint within 25 m", () => {
    const near = square(18, 0, 5); // nearest edge 13 m away
    const result = footprintAt([square(-40, 0, 5), near], site);
    expect(result?.match).toBe("nearest");
    expect(result?.footprint).toBe(near);
    expect(result?.distanceMeters).toBeCloseTo(13, 0);
  });

  it("returns null when nothing is close, rather than inventing a building", () => {
    expect(footprintAt([square(60, 0, 5)], site)).toBeNull();
    expect(footprintAt([], site)).toBeNull();
  });

  it("does not count a point inside a courtyard hole as inside the building", () => {
    const ring = square(0, 0, 20).rings[0];
    const hole = square(0, 0, 5).rings[0];
    const result = footprintAt(
      [{ rings: [ring, hole], heightMeters: 10 }],
      site,
    );
    expect(result?.match).toBe("nearest");
  });
});

describe("tileFor", () => {
  it("returns the zoom-14 tile whose bounds contain the site point", () => {
    const { x, y } = tileFor(site[0], site[1]);
    const n = 2 ** 14;
    const lng = (tx: number) => (tx / n) * 360 - 180;
    const lat = (ty: number) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
    expect(lng(x)).toBeLessThanOrEqual(site[0]);
    expect(lng(x + 1)).toBeGreaterThan(site[0]);
    expect(lat(y)).toBeGreaterThanOrEqual(site[1]);
    expect(lat(y + 1)).toBeLessThan(site[1]);
  });
});
