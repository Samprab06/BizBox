import { describe, it, expect } from "vitest";
import { storyCardLayout } from "./map-layout";
describe("geographically associated glass cards", () => {
  it.each([
    { width: 320, height: 667 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ])(
    "keeps edge/top cards within the readable canvas at $width",
    (viewport) => {
      const points = [
        { id: "left", x: -15, y: 0 },
        { id: "right", x: viewport.width - 5, y: 100 },
      ];
      const layout = storyCardLayout(points, viewport);
      for (const point of points) {
        const offset = layout.offsets.get(point.id)!;
        const cx = point.x + offset.x,
          cy = point.y + offset.y;
        expect(cx - layout.width / 2).toBeGreaterThanOrEqual(layout.safe.left);
        expect(cx + layout.width / 2).toBeLessThanOrEqual(viewport.width - 18);
        expect(cy - layout.height / 2).toBeGreaterThanOrEqual(layout.safe.top);
        expect(cy + layout.height / 2).toBeLessThanOrEqual(
          viewport.height - 99,
        );
      }
    },
  );
  it("clears labels when projection has no visible pins", () =>
    expect(storyCardLayout([], { width: 390, height: 844 }).offsets.size).toBe(
      0,
    ));
});
