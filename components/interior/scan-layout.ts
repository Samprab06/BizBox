import type { interiorFrame } from "../simulator/interior-state";

type Frame = ReturnType<typeof interiorFrame>;
type Person = {
  id: string;
  role: "customer" | "employee";
  state: string;
  x: number;
  z: number;
};
const spacing = 2.2;

/** Remaining arc length is monotonic even across the legacy path's turns. */
function remainingPath(
  x: number,
  z: number,
  points: readonly [number, number][],
) {
  const lengths = points
    .slice(1)
    .map(([nextX, nextZ], index) =>
      Math.hypot(nextX - points[index][0], nextZ - points[index][1]),
    );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let walked = 0;
  let bestDistance = Infinity;
  let remaining = total;
  lengths.forEach((length, index) => {
    const [startX, startZ] = points[index];
    const dx = points[index + 1][0] - startX;
    const dz = points[index + 1][1] - startZ;
    const fraction = Math.max(
      0,
      Math.min(1, ((x - startX) * dx + (z - startZ) * dz) / (length * length)),
    );
    const distance = Math.hypot(
      x - startX - fraction * dx,
      z - startZ - fraction * dz,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      remaining = total - walked - fraction * length;
    }
    walked += length;
  });
  return { remaining, total };
}

/** Scan-only illustrative placement in metres. This does not model floor capacity. */
export function scanLayout(frame: Frame, stationCount: number) {
  const serviceX = (index: number) =>
    (index - (stationCount - 1) / 2) * spacing;
  const serviceByCustomer = new Map(frame.serving);
  const people: Person[] = frame.customers.map((dot) => {
    if (dot.state === "waiting") {
      const index = frame.waiting.indexOf(dot.id);
      return {
        ...dot,
        role: "customer",
        x: index < 4 ? 0 : (index - 3) * spacing,
        z: Math.min(index + 1, 4) * spacing,
      };
    }
    if (dot.state === "serving")
      return {
        ...dot,
        role: "customer",
        x: serviceX(serviceByCustomer.get(dot.id) ?? 0),
        z: 0,
      };
    if (dot.state === "approaching") {
      const route = remainingPath(dot.x, dot.z, [
        [-8, 3.4],
        [0, 3.4],
        [0, 2.5],
      ]);
      return {
        ...dot,
        role: "customer",
        x: -4,
        z: 2.2 + (7.8 * route.remaining) / route.total,
      };
    }
    const route = remainingPath(dot.x, dot.z, [
      [-6, -0.75],
      [3.35, -0.75],
      [3.35, 2.2],
      [0, 2.5],
      [0, 3.4],
      [8, 3.4],
    ]);
    return {
      ...dot,
      role: "customer",
      x: -6,
      z: 2.2 + 7.8 * (1 - route.remaining / route.total),
    };
  });
  people.push(
    ...frame.employees.map((dot): Person => ({
      ...dot,
      role: "employee",
      state: "staffing",
      x: serviceX(dot.station - 1),
      z: -spacing,
    })),
  );
  const stations = Array.from({ length: stationCount }, (_, index) => ({
    x: serviceX(index),
    z: -spacing / 2,
  }));
  return { people, stations };
}
