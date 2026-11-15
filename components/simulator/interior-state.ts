import type { DayResult } from "@/lib/sim/contracts";
import { replayAt } from "../replay/replay-state";
import {
  projectCustomerMotion,
  projectEmployeeMotion,
  type CustomerMotionDot,
  type CustomerMotionGeometry,
} from "./customer-motion";

export type CustomerDot = CustomerMotionDot;
export type EmployeeDot = {
  id: string;
  x: number;
  z: number;
  station: number;
  state: "staffing" | "leaving";
};
/** Display coordinates only; no collision or pedestrian travel-time model is implied. */
export function stationPosition(index: number, count: number) {
  return (index - (count - 1) / 2) * Math.min(2.6, 6 / Math.max(1, count));
}
const geometries = new Map<number, CustomerMotionGeometry>();
export function modeledCustomerMotionGeometry(
  count: number,
): CustomerMotionGeometry {
  const cached = geometries.get(count);
  if (cached) return cached;
  const geometry: CustomerMotionGeometry = {
    entrance: { x: 0, z: 2.5 },
    outsideApproach: { x: -8, z: 3.4 },
    outsideExit: { x: 12, z: 3.4 },
    approachVia: [{ x: 0, z: 3.4 }],
    exitVia: [
      { x: 3.35, z: 2.2 },
      { x: 0, z: 2.5 },
      { x: 0, z: 3.4 },
    ],
    queueSlot: (index) => {
      const row = Math.floor(index / 9),
        column = row % 2 === 0 ? index % 9 : 8 - (index % 9);
      return { x: -2.6 + column * 0.62, z: 0.25 + row * 0.45 };
    },
    stationPoint: (index) => ({ x: stationPosition(index, count), z: -0.75 }),
    staffPoint: (index) => ({ x: stationPosition(index, count), z: -2.45 }),
  };
  geometries.set(count, geometry);
  return geometry;
}

/** Pure event-time replay. Exact engine cohorts/counts coexist with continuous walking glyphs. */
export function interiorFrame(
  run: DayResult,
  minute: number,
  employeeCount?: number,
) {
  const frame = replayAt(run.events, minute),
    geometry = modeledCustomerMotionGeometry(run.metrics.stations);
  const customers = projectCustomerMotion(run, minute, geometry),
    employees = projectEmployeeMotion(
      run,
      minute,
      employeeCount ?? 0,
      geometry,
    );
  let waitSum = 0,
    serviceStarts = 0;
  for (const event of run.events)
    if (event.type === "service_start" && event.timeMin <= minute) {
      waitSum += event.waitMin;
      serviceStarts++;
    }
  return {
    ...frame,
    customers,
    employees,
    meanWaitMin: serviceStarts === 0 ? null : waitSum / serviceStarts,
    motion: { run, minute, employeeCount },
  };
}
