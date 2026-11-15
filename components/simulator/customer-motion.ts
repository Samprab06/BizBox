import type { DayResult } from "@/lib/sim/contracts";
import { replayAt } from "../replay/replay-state";

export type MotionPoint = { x: number; z: number };
export type CustomerMotionGeometry = {
  entrance: MotionPoint;
  outsideApproach: MotionPoint;
  outsideExit: MotionPoint;
  approachVia?: readonly MotionPoint[];
  exitVia?: readonly MotionPoint[];
  queueSlot: (index: number) => MotionPoint;
  stationPoint: (index: number) => MotionPoint;
  staffPoint?: (index: number) => MotionPoint;
  walkSpeedMPerMin?: number;
  approachDurationMin?: number;
  exitDurationMin?: number;
};
export type CustomerMotionDot = MotionPoint & {
  id: string;
  state: "approaching" | "waiting" | "serving" | "leaving";
};
export type EmployeeMotionDot = MotionPoint & {
  id: string;
  station: number;
  state: "staffing" | "leaving";
};
export const CUSTOMER_TRANSIT_MINUTES = 2;
export const CUSTOMER_WALK_METERS_PER_MINUTE = 2.2;
type Segment = { start: number; end: number; path: MotionPoint[] };
type Track = {
  id: string;
  arrival: number;
  departure?: number;
  exitEnd?: number;
  target: MotionPoint;
  segments: Segment[];
};
const cache = new WeakMap<
  DayResult,
  WeakMap<CustomerMotionGeometry, Map<string, Track>>
>();
const copy = (point: MotionPoint): MotionPoint => ({ x: point.x, z: point.z });
const distance = (a: MotionPoint, b: MotionPoint) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const length = (path: readonly MotionPoint[]) =>
  path
    .slice(1)
    .reduce((sum, point, index) => sum + distance(path[index]!, point), 0);

/** Constant-speed deterministic path sampling, independent of renderer state or frame rate. */
export function motionPointAlong(
  path: readonly MotionPoint[],
  fraction: number,
): MotionPoint {
  if (!path.length) return { x: 0, z: 0 };
  const lengths = path
    .slice(1)
    .map((point, index) => distance(path[index]!, point));
  let remaining =
    lengths.reduce((sum, n) => sum + n, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length) {
      const a = path[i]!,
        b = path[i + 1]!,
        t = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return copy(path[path.length - 1]!);
}
function pointAt(track: Track, minute: number): MotionPoint {
  let low = 0,
    high = track.segments.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (track.segments[mid]!.start <= minute) low = mid;
    else high = mid - 1;
  }
  const segment = track.segments[low]!;
  return motionPointAlong(
    segment.path,
    segment.end === segment.start
      ? 1
      : (minute - segment.start) / (segment.end - segment.start),
  );
}
function compiled(
  run: DayResult,
  geometry: CustomerMotionGeometry,
): Map<string, Track> {
  let geometries = cache.get(run);
  if (!geometries) {
    geometries = new WeakMap();
    cache.set(run, geometries);
  }
  const cached = geometries.get(geometry);
  if (cached) return cached;
  const tracks = new Map<string, Track>();
  const approachPath = [
    geometry.outsideApproach,
    ...(geometry.approachVia ?? []),
    geometry.entrance,
  ].map(copy);
  const speed = geometry.walkSpeedMPerMin ?? CUSTOMER_WALK_METERS_PER_MINUTE;
  const approach = Math.max(
    geometry.approachDurationMin ?? CUSTOMER_TRANSIT_MINUTES,
    length(approachPath) / speed,
  );
  const exit = geometry.exitDurationMin ?? CUSTOMER_TRANSIT_MINUTES;
  if (!(approach > 0 && exit > 0 && speed > 0))
    throw new RangeError("Motion durations and speed must be positive");
  for (const event of run.events)
    if (event.type === "arrival")
      tracks.set(event.customerId, {
        id: event.customerId,
        arrival: event.timeMin,
        target: copy(geometry.entrance),
        segments: [
          {
            start: event.timeMin - approach,
            end: event.timeMin,
            path: approachPath,
          },
        ],
      });
  const waiting: string[] = [],
    serving = new Map<string, number>();
  const events = run.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.timeMin - b.event.timeMin || a.index - b.index)
    .map((entry) => entry.event);
  const remove = (id: string) => {
    const index = waiting.indexOf(id);
    if (index >= 0) waiting.splice(index, 1);
    serving.delete(id);
  };
  const target = (id: string, goal: MotionPoint, time: number) => {
    const track = tracks.get(id);
    if (
      !track ||
      track.departure !== undefined ||
      distance(track.target, goal) < 1e-9
    )
      return;
    const from = pointAt(track, time);
    track.target = copy(goal);
    track.segments.push({
      start: time,
      end: time + distance(from, goal) / speed,
      path: [from, copy(goal)],
    });
  };
  for (let i = 0; i < events.length;) {
    const time = events[i]!.timeMin;
    do {
      const event = events[i++]!;
      if (event.type === "queue_entry") {
        if (!waiting.includes(event.customerId)) waiting.push(event.customerId);
      }
      if (event.type === "service_start") {
        remove(event.customerId);
        serving.set(event.customerId, event.stationIndex);
      }
      const departure =
        event.type === "completion" ||
        event.type === "abandonment" ||
        (event.type === "arrival" && event.decision === "leave");
      if (departure) {
        const track = tracks.get(event.customerId);
        remove(event.customerId);
        if (track && track.departure === undefined) {
          const from = pointAt(track, time);
          track.departure = time;
          track.target = copy(geometry.outsideExit);
          const path = [
            from,
            ...(geometry.exitVia ?? []),
            geometry.outsideExit,
          ].map(copy);
          track.exitEnd = time + Math.max(exit, length(path) / speed);
          track.segments.push({ start: time, end: track.exitEnd, path });
        }
      }
    } while (i < events.length && events[i]!.timeMin === time);
    waiting.forEach((id, index) => target(id, geometry.queueSlot(index), time));
    serving.forEach((station, id) =>
      target(id, geometry.stationPoint(station), time),
    );
  }
  geometries.set(geometry, tracks);
  return tracks;
}

/** Engine cohort labels stay exact; only glyph coordinates interpolate between event targets. */
export function projectCustomerMotion(
  run: DayResult,
  minute: number,
  geometry: CustomerMotionGeometry,
): CustomerMotionDot[] {
  if (!Number.isFinite(minute)) return [];
  const tracks = compiled(run, geometry),
    frame = replayAt(run.events, minute);
  const result: CustomerMotionDot[] = [];
  const emit = (id: string, state: CustomerMotionDot["state"]) => {
    const track = tracks.get(id);
    if (track) result.push({ id, state, ...pointAt(track, minute) });
  };
  frame.waiting.forEach((id) => emit(id, "waiting"));
  frame.serving.forEach(([id]) => emit(id, "serving"));
  for (const track of tracks.values()) {
    if (minute >= track.segments[0]!.start && minute < track.arrival)
      emit(track.id, "approaching");
    else if (
      track.departure !== undefined &&
      minute >= track.departure &&
      minute < track.exitEnd!
    )
      emit(track.id, "leaving");
  }
  return result;
}

/** Employee display exit has no effect on staffing inputs, counts or economics. */
export function projectEmployeeMotion(
  run: DayResult,
  minute: number,
  employeeCount: number,
  geometry: CustomerMotionGeometry,
): EmployeeMotionDot[] {
  const close = run.metrics.closeMin,
    exit = geometry.exitDurationMin ?? CUSTOMER_TRANSIT_MINUTES;
  if (minute < run.metrics.openMin) return [];
  return Array.from(
    {
      length: Math.min(
        Math.max(0, Math.floor(employeeCount)),
        run.metrics.stations,
      ),
    },
    (_, index) => {
      const start = (geometry.staffPoint ?? geometry.stationPoint)(index);
      const path = [start, ...(geometry.exitVia ?? []), geometry.outsideExit],
        duration = Math.max(
          exit,
          length(path) /
            (geometry.walkSpeedMPerMin ?? CUSTOMER_WALK_METERS_PER_MINUTE),
        );
      return minute >= close + duration
        ? null
        : {
            id: `employee-${index + 1}`,
            station: index + 1,
            state:
              minute < close ? ("staffing" as const) : ("leaving" as const),
            ...(minute < close
              ? start
              : motionPointAlong(path, (minute - close) / duration)),
          };
    },
  ).filter((dot): dot is EmployeeMotionDot => dot !== null);
}

export function customerMotionWindow(
  run: DayResult,
  id: string,
  geometry: CustomerMotionGeometry,
) {
  const track = compiled(run, geometry).get(id);
  return track
    ? { startMin: track.segments[0]!.start, endMin: track.exitEnd ?? null }
    : undefined;
}
