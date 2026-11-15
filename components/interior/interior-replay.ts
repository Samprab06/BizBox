import type { DayResult, SimEvent } from "@/lib/sim/contracts";
import {
  pointAlong,
  polylineLength,
  type FloorPoint,
  type InteriorLayout,
} from "@/lib/sim/interior-layout";
import { replayAt } from "../replay/replay-state";

/** Agent states rendered inside the room (SIM-13). */
export type InteriorAgentState =
  "entering" | "in_line" | "at_station" | "leaving";
export type InteriorAgent = {
  id: string;
  role: "customer" | "employee";
  state: InteriorAgentState | "staffing";
  x: number;
  z: number;
  /** Engine stationIndex for customers at a station and for staff. */
  station?: number;
};
/** The in-room counts. They come straight from `replayAt`, the city view's source. */
export type InteriorCounts = {
  arrivals: number;
  inLine: number;
  inService: number;
  served: number;
  left: number;
};

/**
 * Minutes an arriving or leaving customer is drawn between the door and the
 * outside point. The same illustrative two-minute window as the modeled café; it
 * is not a measured walking time.
 */
export const TRANSIT_MINUTES = 2;

export function interiorCountsAt(
  events: readonly SimEvent[],
  minute: number,
): InteriorCounts {
  const frame = replayAt(events, minute);
  return {
    arrivals: frame.arrivals.size,
    inLine: frame.waiting.length,
    inService: frame.serving.length,
    served: frame.served,
    left: frame.left,
  };
}

const lerp = (a: FloorPoint, b: FloorPoint, t: number): FloorPoint => {
  const k = Math.max(0, Math.min(1, t));
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
};
function along(points: readonly FloorPoint[], t: number) {
  return pointAlong(
    points,
    Math.max(0, Math.min(1, t)) * polylineLength(points),
  );
}

/**
 * Pure projection of one run at one minute onto a layout. Seeking holds no state:
 * the same (run, minute, layout) always yields the same agents, and the in-line and
 * at-station agents are exactly `replayAt`'s waiting and serving customers.
 */
export function interiorFrameAt(
  run: DayResult,
  minute: number,
  layout: InteriorLayout,
  employeeCount?: number,
) {
  if (layout.stations.length < run.metrics.stations)
    throw new RangeError("The layout has fewer stations than the run");
  const frame = replayAt(run.events, minute);
  const counts: InteriorCounts = {
    arrivals: frame.arrivals.size,
    inLine: frame.waiting.length,
    inService: frame.serving.length,
    served: frame.served,
    left: frame.left,
  };
  const agents: InteriorAgent[] = [];
  const tail = layout.queue[layout.queue.length - 1];
  frame.waiting.forEach((id, index) => {
    const at = pointAlong(layout.queue, index * layout.queueSpacingM);
    agents.push({ id, role: "customer", state: "in_line", ...at });
  });
  for (const [id, station] of frame.serving)
    agents.push({
      id,
      role: "customer",
      state: "at_station",
      station,
      ...layout.stations[station],
    });
  const placed = new Set(agents.map((agent) => agent.id));
  for (const event of run.events) {
    if (event.timeMin > minute + TRANSIT_MINUTES) break;
    if (placed.has(event.customerId)) continue;
    if (event.type === "arrival" && event.timeMin > minute) {
      const t = 1 - (event.timeMin - minute) / TRANSIT_MINUTES;
      agents.push({
        id: event.customerId,
        role: "customer",
        state: "entering",
        ...along([layout.outside, layout.entrance, tail], t),
      });
      placed.add(event.customerId);
      continue;
    }
    const departing =
      event.type === "completion" ||
      event.type === "abandonment" ||
      (event.type === "arrival" && event.decision === "leave");
    if (
      departing &&
      event.timeMin <= minute &&
      minute < event.timeMin + TRANSIT_MINUTES
    ) {
      const start =
        event.type === "completion"
          ? layout.stations[event.stationIndex]
          : event.type === "abandonment"
            ? tail
            : layout.entrance;
      const t = (minute - event.timeMin) / TRANSIT_MINUTES;
      agents.push({
        id: event.customerId,
        role: "customer",
        state: "leaving",
        ...(event.type === "arrival"
          ? lerp(start, layout.outside, t)
          : along([start, layout.entrance, layout.outside], t)),
      });
      placed.add(event.customerId);
    }
  }
  const open = minute >= run.metrics.openMin && minute < run.metrics.closeMin;
  const staffed = open ? Math.min(employeeCount ?? 0, run.metrics.stations) : 0;
  for (let station = 0; station < staffed; station++)
    agents.push({
      id: `employee-${station + 1}`,
      role: "employee",
      state: "staffing",
      station,
      ...layout.staff[station],
    });
  return {
    counts,
    agents,
    /** People in line beyond the queue polyline's capacity (drawn past its tail). */
    overflow: Math.max(0, counts.inLine - layout.queueCapacity),
    arrivals: frame.arrivals,
  };
}
export type InteriorFrame = ReturnType<typeof interiorFrameAt>;
