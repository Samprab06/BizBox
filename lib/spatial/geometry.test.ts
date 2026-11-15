import { describe, it, expect } from "vitest";
import { createSpatialDraft } from "./index";
import { itemBounds, routeThroughRoom } from "./geometry";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
describe("spatial boundary connections", () => {
  it("keeps actual boundary endpoints in non-grid-aligned rooms without grid-key aliasing", () => {
    const draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
      widthM: 4.4,
      depthM: 4.4,
    });
    draft.entrance = { x: 4.4, z: 1 };
    draft.servicePoint = { x: 1.1, z: 4.4 };
    const path = routeThroughRoom(draft);
    expect(path[0]).toEqual(draft.entrance);
    expect(path.at(-1)).toEqual(draft.servicePoint);
    expect(
      path.every((p) => p.x >= 0 && p.z >= 0 && p.x <= 4.4 && p.z <= 4.4),
    ).toBe(true);
    expect(
      Math.hypot(path[1]!.x - path[0]!.x, path[1]!.z - path[0]!.z),
    ).toBeLessThanOrEqual(0.71);
  });
  it("rejects a real endpoint inside an obstacle even when its snapped cell is free", () => {
    const draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    });
    const chair = FURNITURE_CATALOG.find((c) => c.role === "seating")!;
    const item = {
      id: "chair",
      catalogId: chair.id,
      x: 3.2,
      z: 3.2,
      rotation: 0 as const,
    };
    draft.items = [item];
    const b = itemBounds(item);
    draft.entrance = { x: b.minX - 0.39, z: b.minZ - 0.39 };
    expect(() => routeThroughRoom(draft)).toThrow();
  });
  it("rejects invalid endpoint coordinates instead of wrapping their grid identity", () => {
    const draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    });
    draft.entrance = { x: 10.1, z: 1 };
    expect(() => routeThroughRoom(draft)).toThrow();
  });
});
