import type { LayoutPoint } from "@/lib/contracts/layout";
import type { ScanPlacement } from "@/lib/contracts/interior";

/**
 * HAC-138: one transform from `lib/layout` room coordinates (feet, plan X/Y)
 * to Matterport scan coordinates.
 *
 * - Room space: HAC-86 layout feet. Plan `x` is across, plan `y` is depth.
 * - Scan (SDK) space: Showcase SDK metres, Y-up. Plan x → local x, plan y →
 *   local z, then rotated about +Y by `rotationY` (three.js convention, the
 *   same as the overlay root in `matterport-scene.ts`) and offset by `origin`.
 * - API space: the Model API is Z-up; `fromSdkToApi(x, y, z) = [x, -z, y]`.
 */
export type Vec3 = { x: number; y: number; z: number };
export const FEET_TO_METERS = 0.3048;
/** Picked floor points whose fitted scale differs by more than this are rejected. */
export const UNIT_TOLERANCE = 0.1;

export function fromSdkToApi({ x, y, z }: Vec3): Vec3 {
  return { x, y: -z, z: y };
}
export function fromApiToSdk({ x, y, z }: Vec3): Vec3 {
  return { x, y: z, z: -y };
}

type Rigid = Pick<ScanPlacement, "origin" | "rotationY" | "floorY">;

/** A room point (feet) at `heightM` metres above the picked floor, in SDK space. */
export function roomToScan(
  placement: Rigid,
  point: LayoutPoint,
  heightM = 0,
): Vec3 {
  const lx = point.x * FEET_TO_METERS;
  const lz = point.y * FEET_TO_METERS;
  const cos = Math.cos(placement.rotationY);
  const sin = Math.sin(placement.rotationY);
  return {
    x: placement.origin.x + lx * cos + lz * sin,
    y: placement.floorY + heightM,
    z: placement.origin.z - lx * sin + lz * cos,
  };
}

/** The same point in Model API (Z-up) coordinates. */
export function roomToApi(
  placement: Rigid,
  point: LayoutPoint,
  heightM = 0,
): Vec3 {
  return fromSdkToApi(roomToScan(placement, point, heightM));
}

/** Inverse of `roomToScan`, projected onto the floor plane. */
export function scanToRoom(placement: Rigid, scan: Vec3): LayoutPoint {
  const dx = scan.x - placement.origin.x;
  const dz = scan.z - placement.origin.z;
  const cos = Math.cos(placement.rotationY);
  const sin = Math.sin(placement.rotationY);
  return {
    x: (dx * cos - dz * sin) / FEET_TO_METERS,
    y: (dx * sin + dz * cos) / FEET_TO_METERS,
  };
}

export class PlacementSolveError extends Error {}
export type AnchorPair = { room: LayoutPoint; scan: Vec3 };
export type SolvedPlacement = {
  placement: Rigid;
  /** Root-mean-square horizontal fit error, metres. */
  rmsErrorM: number;
  /** Scan spread over room spread; ≈1 when room feet and scan metres agree. */
  unitRatio: number;
};

const normalizeAngle = (angle: number) => {
  const turn = 2 * Math.PI;
  const wrapped = ((angle % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
};

/**
 * Least-squares rigid fit (2D Procrustes about +Y) from 2–3 picked floor
 * points. Scale is not fitted: it is measured and must be ≈1, which verifies
 * the feet→metres units against the known room dimensions.
 */
export function solvePlacement(pairs: readonly AnchorPair[]): SolvedPlacement {
  if (pairs.length < 2 || pairs.length > 3)
    throw new PlacementSolveError("Pick two or three floor anchors");
  const room = pairs.map(({ room }) => ({
    x: room.x * FEET_TO_METERS,
    z: room.y * FEET_TO_METERS,
  }));
  const scan = pairs.map(({ scan }) => scan);
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const roomCx = mean(room.map((p) => p.x));
  const roomCz = mean(room.map((p) => p.z));
  const scanCx = mean(scan.map((p) => p.x));
  const scanCz = mean(scan.map((p) => p.z));
  let dot = 0;
  let cross = 0;
  let roomSpread = 0;
  let scanSpread = 0;
  room.forEach((p, index) => {
    const px = p.x - roomCx;
    const pz = p.z - roomCz;
    const qx = scan[index].x - scanCx;
    const qz = scan[index].z - scanCz;
    dot += qx * px + qz * pz;
    cross += qx * pz - qz * px;
    roomSpread += px * px + pz * pz;
    scanSpread += qx * qx + qz * qz;
  });
  if (roomSpread < 1e-6 || scanSpread < 1e-6)
    throw new PlacementSolveError("Anchors must be distinct points");
  const unitRatio = Math.sqrt(scanSpread / roomSpread);
  if (Math.abs(unitRatio - 1) > UNIT_TOLERANCE)
    throw new PlacementSolveError(
      `Anchor spacing differs from the room by ×${unitRatio.toFixed(3)}; check the room units (feet) and the picked points`,
    );
  const rotationY = normalizeAngle(Math.atan2(cross, dot));
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const floorY = mean(scan.map((p) => p.y));
  const placement: Rigid = {
    origin: {
      x: scanCx - (roomCx * cos + roomCz * sin),
      y: floorY,
      z: scanCz - (-roomCx * sin + roomCz * cos),
    },
    rotationY,
    floorY,
  };
  const squared = pairs.map((pair) => {
    const fitted = roomToScan(placement, pair.room);
    return (fitted.x - pair.scan.x) ** 2 + (fitted.z - pair.scan.z) ** 2;
  });
  return { placement, rmsErrorM: Math.sqrt(mean(squared)), unitRatio };
}
