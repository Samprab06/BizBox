import { describe, expect, test } from "vitest";
import { toScanWorld } from "@/components/interior/camera";
import { publicCafeScan } from "@/lib/interior/fixtures";
import {
  FEET_TO_METERS,
  PlacementSolveError,
  fromApiToSdk,
  fromSdkToApi,
  roomToApi,
  roomToScan,
  scanToRoom,
  solvePlacement,
} from "./scan-transform";

const identity = {
  origin: { x: 0, y: 0, z: 0 },
  rotationY: 0,
  floorY: 0,
};
const close = (a: { x: number; y: number; z?: number }, b: typeof a) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  if (a.z !== undefined || b.z !== undefined)
    expect(a.z ?? 0).toBeCloseTo(b.z ?? 0, 9);
};

describe("axis swap", () => {
  test("fromSdkToApi(x, y, z) = [x, -z, y] and round-trips", () => {
    expect(fromSdkToApi({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: -3, z: 2 });
    expect(fromApiToSdk({ x: 1, y: -3, z: 2 })).toEqual({ x: 1, y: 2, z: 3 });
    for (const p of [
      { x: 0.5, y: -4, z: 9 },
      { x: -17.1, y: 0.04, z: 10.3 },
    ])
      expect(fromApiToSdk(fromSdkToApi(p))).toEqual(p);
  });

  test("SDK height becomes API Z (up), plan depth becomes API -Y", () => {
    const placement = { ...identity, floorY: 1.5 };
    const api = roomToApi(placement, { x: 10, y: 20 }, 0.4);
    expect(api.z).toBeCloseTo(1.9, 9);
    expect(api.x).toBeCloseTo(10 * FEET_TO_METERS, 9);
    expect(api.y).toBeCloseTo(-20 * FEET_TO_METERS, 9);
  });
});

describe("roomToScan", () => {
  test("units: a 1000 sq ft synthetic room's 32.8084 ft wall spans 10 m", () => {
    // interior-fixture-scan's floor is 10 m × 9.290304 m = 1000 sq ft.
    const a = roomToScan(identity, { x: 0, y: 0 });
    const b = roomToScan(identity, { x: 10 / FEET_TO_METERS, y: 0 });
    const c = roomToScan(identity, { x: 0, y: 9.290304 / FEET_TO_METERS });
    expect(b.x - a.x).toBeCloseTo(10, 9);
    expect(c.z - a.z).toBeCloseTo(9.290304, 9);
    expect(((b.x - a.x) * (c.z - a.z)) / FEET_TO_METERS ** 2).toBeCloseTo(
      1000,
      6,
    );
  });

  test("rotation follows three.js +Y and matches the overlay root", () => {
    const placement = {
      origin: { x: 4, y: -1, z: 7 },
      rotationY: Math.PI / 2,
      floorY: -1,
    };
    close(roomToScan(placement, { x: 1 / FEET_TO_METERS, y: 0 }), {
      x: 4,
      y: -1,
      z: 6,
    });
    close(roomToScan(placement, { x: 0, y: 1 / FEET_TO_METERS }), {
      x: 5,
      y: -1,
      z: 7,
    });
  });

  test("agrees with the camera's toScanWorld for the café registry row", () => {
    const placement = publicCafeScan.placement;
    for (const local of [
      { x: 0, z: 0 },
      { x: 2.2, z: -1.1 },
      { x: -6, z: 10 },
    ]) {
      const viaLayout = roomToScan(
        placement,
        { x: local.x / FEET_TO_METERS, y: local.z / FEET_TO_METERS },
        0.4,
      );
      close(viaLayout, toScanWorld(placement, local));
    }
  });

  test("scanToRoom inverts roomToScan", () => {
    const placement = {
      origin: { x: 17.1, y: 0.04, z: 10.3 },
      rotationY: 2.1,
      floorY: 0.04,
    };
    const point = { x: 12.5, y: -3.25 };
    close(scanToRoom(placement, roomToScan(placement, point)), point);
  });
});

describe("solvePlacement", () => {
  const truth = {
    origin: { x: 17.1, y: 0.04, z: 10.3 },
    rotationY: Math.PI,
    floorY: 0.04,
  };
  const corners = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 0, y: 15 },
  ];

  test("recovers a known placement from three floor picks", () => {
    const solved = solvePlacement(
      corners.map((room) => ({ room, scan: roomToScan(truth, room) })),
    );
    close(solved.placement.origin, truth.origin);
    expect(Math.abs(solved.placement.rotationY)).toBeCloseTo(Math.PI, 9);
    expect(solved.placement.floorY).toBeCloseTo(0.04, 9);
    expect(solved.rmsErrorM).toBeLessThan(1e-9);
    expect(solved.unitRatio).toBeCloseTo(1, 9);
  });

  test("two picks are enough and noisy picks report their error", () => {
    const placement = { ...truth, rotationY: -0.7 };
    const two = solvePlacement(
      corners
        .slice(0, 2)
        .map((room) => ({ room, scan: roomToScan(placement, room) })),
    );
    expect(two.placement.rotationY).toBeCloseTo(-0.7, 9);
    const noisy = solvePlacement(
      corners.map((room, index) => {
        const scan = roomToScan(placement, room);
        return { room, scan: { ...scan, x: scan.x + (index - 1) * 0.05 } };
      }),
    );
    expect(noisy.rmsErrorM).toBeGreaterThan(0);
    expect(noisy.rmsErrorM).toBeLessThan(0.05);
  });

  test("rejects metres mistaken for feet, and degenerate anchors", () => {
    // Room authored in metres instead of feet: scan spread is ×3.28.
    expect(() =>
      solvePlacement(
        corners.map((room) => ({
          room: { x: room.x * FEET_TO_METERS, y: room.y * FEET_TO_METERS },
          scan: roomToScan(truth, room),
        })),
      ),
    ).toThrow(PlacementSolveError);
    expect(() =>
      solvePlacement([
        { room: { x: 1, y: 1 }, scan: { x: 0, y: 0, z: 0 } },
        { room: { x: 1, y: 1 }, scan: { x: 0, y: 0, z: 0 } },
      ]),
    ).toThrow(PlacementSolveError);
    expect(() =>
      solvePlacement([{ room: { x: 0, y: 0 }, scan: { x: 0, y: 0, z: 0 } }]),
    ).toThrow(PlacementSolveError);
  });

  test("is deterministic", () => {
    const pairs = corners.map((room) => ({
      room,
      scan: roomToScan({ ...truth, rotationY: 1.234 }, room),
    }));
    expect(solvePlacement(pairs)).toEqual(solvePlacement(pairs));
  });
});
