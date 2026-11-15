import type { interiorFrame } from "../simulator/interior-state";
import {
  projectCustomerMotion,
  projectEmployeeMotion,
  type CustomerMotionGeometry,
} from "../simulator/customer-motion";
type Frame = ReturnType<typeof interiorFrame>;
type Person = {
  id: string;
  role: "customer" | "employee";
  state: string;
  x: number;
  z: number;
};
const spacing = 2.2;
const geometries = new Map<number, CustomerMotionGeometry>();
/** Fixed reference-scan geometry; coordinates remain illustrative meters. */
export function scanMotionGeometry(
  stationCount: number,
): CustomerMotionGeometry {
  let geometry = geometries.get(stationCount);
  if (!geometry) {
    geometry = {
      entrance: { x: -4, z: 2.2 },
      outsideApproach: { x: -4, z: 10 },
      outsideExit: { x: -6, z: 10 },
      exitVia: [{ x: -6, z: 2.2 }],
      queueSlot: (index) => ({
        x: index < 4 ? 0 : (index - 3) * spacing,
        z: Math.min(index + 1, 4) * spacing,
      }),
      staffPoint: (index) => ({
        x: (index - (stationCount - 1) / 2) * spacing,
        z: -spacing,
      }),
      stationPoint: (index) => ({
        x: (index - (stationCount - 1) / 2) * spacing,
        z: 0,
      }),
      walkSpeedMPerMin: 2.2,
      approachDurationMin: 2,
      exitDurationMin: 2,
    };
    geometries.set(stationCount, geometry);
  }
  return geometry;
}
/** Continuous event-time motion shared with modeled view; no state-specific teleport. */
export function scanLayout(frame: Frame, stationCount: number) {
  const geometry = scanMotionGeometry(stationCount);
  const people: Person[] = projectCustomerMotion(
    frame.motion.run,
    frame.motion.minute,
    geometry,
  ).map((dot) => ({ ...dot, role: "customer" }));
  people.push(
    ...projectEmployeeMotion(
      frame.motion.run,
      frame.motion.minute,
      frame.motion.employeeCount ?? 0,
      geometry,
    ).map((dot) => ({ ...dot, role: "employee" as const })),
  );
  const stations = Array.from({ length: stationCount }, (_, index) => ({
    x: geometry.stationPoint(index).x,
    z: -spacing / 2,
  }));
  return { people, stations };
}
