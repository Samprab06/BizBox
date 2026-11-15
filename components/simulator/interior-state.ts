import type { DayResult } from "@/lib/sim/contracts";
import { replayAt } from "../replay/replay-state";

export type CustomerDot = {
  id: string;
  x: number;
  z: number;
  state: "approaching" | "waiting" | "serving" | "leaving";
};
export type EmployeeDot = { id: string; x: number; z: number; station: number };

/** Display coordinates only; no collision or pedestrian travel-time model is implied. */
export function stationPosition(index: number, count: number) {
  return (index - (count - 1) / 2) * Math.min(2.6, 6 / Math.max(1, count));
}

function along(points: readonly [number, number][], progress: number) {
  const lengths = points
    .slice(1)
    .map(([x, z], index) =>
      Math.hypot(x - points[index][0], z - points[index][1]),
    );
  let remaining =
    Math.max(0, Math.min(1, progress)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (remaining <= length || i === lengths.length - 1) {
      const portion = length === 0 ? 1 : remaining / length;
      return {
        x: points[i][0] + (points[i + 1][0] - points[i][0]) * portion,
        z: points[i][1] + (points[i + 1][1] - points[i][1]) * portion,
      };
    }
    remaining -= length;
  }
  return { x: points[0][0], z: points[0][1] };
}

/** Pure replay projection: seeking never retains customer or metric state. */
export function interiorFrame(
  run: DayResult,
  minute: number,
  employeeCount?: number,
) {
  const frame = replayAt(run.events, minute);
  const customers: CustomerDot[] = [];
  const rows = Math.ceil(frame.waiting.length / 9);
  const rowGap = rows <= 1 ? 0 : Math.min(0.55, 1.8 / (rows - 1));
  frame.waiting.forEach((id, index) => {
    const row = Math.floor(index / 9);
    const column = row % 2 === 0 ? index % 9 : 8 - (index % 9);
    customers.push({
      id,
      x: -2.6 + column * 0.62,
      z: 0.25 + row * rowGap,
      state: "waiting",
    });
  });
  frame.serving.forEach(([id, station]) =>
    customers.push({
      id,
      x: stationPosition(station, run.metrics.stations),
      z: -0.75,
      state: "serving",
    }),
  );
  const active = new Set(customers.map((dot) => dot.id));
  let waitSum = 0;
  let serviceStarts = 0;
  for (const event of run.events) {
    if (event.type === "service_start" && event.timeMin <= minute) {
      waitSum += event.waitMin;
      serviceStarts++;
    }
    if (active.has(event.customerId)) continue;
    if (
      event.type === "arrival" &&
      event.timeMin > minute &&
      event.timeMin <= minute + 2
    ) {
      customers.push({
        id: event.customerId,
        ...along(
          [
            [-8, 3.4],
            [0, 3.4],
            [0, 2.5],
          ],
          1 - (event.timeMin - minute) / 2,
        ),
        state: "approaching",
      });
      active.add(event.customerId);
    }
    const departure =
      event.type === "completion" ||
      event.type === "abandonment" ||
      (event.type === "arrival" && event.decision === "leave");
    if (departure && event.timeMin <= minute && minute < event.timeMin + 2) {
      const start: [number, number] =
        event.type === "completion"
          ? [stationPosition(event.stationIndex, run.metrics.stations), -0.75]
          : [0, 2.5];
      const route: [number, number][] =
        event.type === "completion"
          ? [start, [3.35, -0.75], [3.35, 2.2], [0, 2.5], [0, 3.4], [8, 3.4]]
          : [start, [0, 3.4], [8, 3.4]];
      customers.push({
        id: event.customerId,
        ...along(route, (minute - event.timeMin) / 2),
        state: "leaving",
      });
      active.add(event.customerId);
    }
  }
  const employees: EmployeeDot[] = Array.from(
    {
      length:
        minute >= run.metrics.openMin && minute < run.metrics.closeMin
          ? Math.min(employeeCount ?? 0, run.metrics.stations)
          : 0,
    },
    (_, index) => ({
      id: `employee-${index + 1}`,
      x: stationPosition(index, run.metrics.stations),
      z: -2.45,
      station: index + 1,
    }),
  );
  return {
    ...frame,
    customers,
    employees,
    meanWaitMin: serviceStarts === 0 ? null : waitSum / serviceStarts,
  };
}
