import { describe, expect, it } from "vitest";
import { getInteriorFixture } from "../interior/fixtures";
import {
  InteriorLayoutSchema,
  LAYOUT_CONVENTIONS,
  layoutFromDimensions,
  layoutFromRoomBounds,
  modeledLayout,
  pointAlong,
  polylineLength,
  type InteriorLayout,
} from "./interior-layout";

const room = { minX: 0, maxX: 10, minZ: 0, maxZ: 9.290304, floorY: 0 };
const inside = (layout: InteriorLayout, p: { x: number; z: number }) =>
  p.x >= layout.bounds.minX - 1e-9 &&
  p.x <= layout.bounds.maxX + 1e-9 &&
  p.z >= layout.bounds.minZ - 1e-9 &&
  p.z <= layout.bounds.maxZ + 1e-9;

describe("pointAlong", () => {
  const line = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 3 },
  ];
  it("walks the polyline by arc length", () => {
    expect(polylineLength(line)).toBe(7);
    expect(pointAlong(line, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(line, 2)).toEqual({ x: 2, z: 0 });
    expect(pointAlong(line, 5)).toEqual({ x: 4, z: 1 });
  });
  it("extends past the tail along the last segment", () => {
    expect(pointAlong(line, 9)).toEqual({ x: 4, z: 5 });
  });
});

describe("layoutFromRoomBounds", () => {
  it("is deterministic and serializable", () => {
    const a = layoutFromRoomBounds(room, 2, { roomId: "r" });
    const b = layoutFromRoomBounds({ ...room }, 2, { roomId: "r" });
    expect(a).toEqual(b);
    expect(InteriorLayoutSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(
      a,
    );
    expect(a.key).toBe(b.key);
    expect(layoutFromRoomBounds(room, 3, { roomId: "r" }).key).not.toBe(a.key);
  });

  it.each(["minZ", "maxZ", "minX", "maxX"] as const)(
    "keeps every proposed object inside the bounds (entrance %s)",
    (entranceWall) => {
      const layout = layoutFromRoomBounds(room, 3, { entranceWall });
      for (const p of [
        layout.entrance,
        layout.counter.from,
        layout.counter.to,
        ...layout.stations,
        ...layout.staff,
        ...layout.queue,
      ])
        expect(inside(layout, p)).toBe(true);
      expect(inside(layout, layout.outside)).toBe(false);
      expect(layout.entranceAssumed).toBe(false);
      expect(layout.fits).toBe(true);
    },
  );

  it("places the line from the counter toward the entrance", () => {
    const layout = layoutFromRoomBounds(room, 1);
    const [head, tail] = layout.queue;
    const c = LAYOUT_CONVENTIONS;
    expect(layout.entrance).toEqual({ x: 5, z: 0 });
    expect(tail.z).toBeCloseTo(c.wallInsetM, 6);
    expect(head.z).toBeCloseTo(
      room.maxZ - c.staffZoneM - c.serviceOffsetM - c.queueHeadGapM,
      2,
    );
    expect(layout.stations[0].z).toBeGreaterThan(head.z);
    expect(layout.staff[0].z).toBeGreaterThan(layout.stations[0].z);
    expect(layout.queueCapacity).toBe(
      Math.floor((head.z - tail.z) / c.queueSpacingM) + 1,
    );
  });

  it("labels an assumed entrance wall", () => {
    const layout = layoutFromRoomBounds(room, 1);
    expect(layout.entranceAssumed).toBe(true);
    expect(layout.limitations.join(" ")).toMatch(/assumed/);
  });

  it("reports, rather than hides, stations that do not fit", () => {
    const layout = layoutFromRoomBounds(
      { minX: 0, maxX: 3, minZ: 0, maxZ: 8, floorY: 0 },
      4,
    );
    expect(layout.fits).toBe(false);
    expect(layout.stations).toHaveLength(4);
    expect(layout.limitations.join(" ")).toMatch(/do not fit/);
  });

  it("reports a room too shallow for a line", () => {
    const layout = layoutFromRoomBounds(
      { minX: 0, maxX: 6, minZ: 0, maxZ: 2.5, floorY: 0 },
      1,
    );
    expect(layout.fits).toBe(false);
    expect(layout.queueCapacity).toBe(0);
  });

  it("rejects empty bounds and zero stations", () => {
    expect(() => layoutFromRoomBounds({ ...room, maxX: 0 }, 1)).toThrow();
    expect(() => layoutFromRoomBounds(room, 0)).toThrow();
  });
});

describe("layoutFromDimensions", () => {
  it("returns null without SIM-12 dimensions instead of inventing geometry", () => {
    expect(layoutFromDimensions(undefined, 2)).toBeNull();
    const publicDemo = getInteriorFixture("interior-public-demo");
    expect(publicDemo?.kind).toBe("scan");
    expect(
      layoutFromDimensions(
        publicDemo?.kind === "scan" ? publicDemo.dimensions : undefined,
        2,
      ),
    ).toBeNull();
  });

  it("uses the recorded room bounds of the synthetic scan fixture", () => {
    const fixture = getInteriorFixture("interior-fixture-scan");
    if (fixture?.kind !== "scan" || !fixture.dimensions)
      throw new Error("fixture changed");
    const layout = layoutFromDimensions(fixture.dimensions, 2)!;
    expect(layout.source).toBe("room-bounds");
    expect(layout.roomId).toBe("synthetic-room");
    expect(layout.bounds).toEqual({
      minX: 0,
      maxX: 10,
      minZ: 0,
      maxZ: 9.290304,
    });
    expect(layoutFromDimensions(fixture.dimensions, 2, { roomId: "x" })).toBe(
      null,
    );
  });
});

describe("modeledLayout", () => {
  it("is the labelled modeled café, never a measurement", () => {
    const layout = modeledLayout(2);
    expect(layout.source).toBe("modeled");
    expect(layout.limitations[0]).toMatch(/Modeled/);
    expect(layout.stations.map((s) => s.x)).toEqual([-1.3, 1.3]);
    expect(layout.queueCapacity).toBeGreaterThan(20);
  });
});
