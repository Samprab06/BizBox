import { replayAt } from "@/components/replay/replay-state";
import type { DayResult } from "@/lib/sim/contracts";
import type { AgentTrip, Position } from "@/lib/sim/trips";

export type TrailPoint = {
  position: Position;
  minute: number;
  /** Fade by simulated age, independent of playback speed or wall-clock frames. */
  opacity: number;
};
export type SampledAgent = {
  customerId: string;
  personaId: string;
  kind: AgentTrip["kind"];
  mode: AgentTrip["mode"];
  position: Position;
  phase: "inbound" | "waiting" | "in_service" | "outbound";
  /** Null until a terminal event at or before the sampled minute. */
  outcome: Exclude<AgentTrip["outcome"], "open"> | null;
  /** Holding the last known unresolved state; not evidence of activity after close. */
  heldAtClose: boolean;
  trail: TrailPoint[];
  approximation: AgentTrip["geometry"]["approximation"];
  sources: ReadonlyArray<Readonly<AgentTrip["geometry"]["sources"][number]>>;
};
export type TripFrame = {
  minute: number;
  agents: SampledAgent[];
  queueLength: number;
  served: number;
  left: number;
  arrivals: number;
};
export type TripFrameOptions = { trailMinutes?: number; trailSamples?: number };
type Run = Pick<DayResult, "events" | "metrics">;

function validateTrip(trip: AgentTrip, arrivals: Map<string, number>) {
  const length = trip.path.length;
  if (
    length === 0 ||
    length !== trip.timestamps.length ||
    !Number.isFinite(trip.visibleEntryMin) ||
    trip.timestamps[0] !== trip.visibleEntryMin ||
    !Number.isInteger(trip.doorArrivalIndex) ||
    trip.doorArrivalIndex < 0 ||
    trip.doorArrivalIndex >= length ||
    (trip.departureIndex !== null &&
      (!Number.isInteger(trip.departureIndex) ||
        trip.departureIndex < trip.doorArrivalIndex ||
        trip.departureIndex >= length)) ||
    arrivals.get(trip.customerId) !== trip.timestamps[trip.doorArrivalIndex]
  )
    throw new RangeError(
      `Trip ${trip.customerId} must match its path, timestamps and recorded arrival`,
    );
  for (let i = 0; i < length; i++) {
    if (
      !Number.isFinite(trip.timestamps[i]) ||
      (i > 0 && trip.timestamps[i] < trip.timestamps[i - 1]) ||
      trip.path[i].length !== 2 ||
      !trip.path[i].every(Number.isFinite)
    )
      throw new RangeError(
        `Trip ${trip.customerId} requires finite positions and nondecreasing timestamps`,
      );
  }
}

/** Right-continuous interpolation: use the last vertex at an equal timestamp. */
function positionAt(trip: AgentTrip, minute: number): Position {
  let low = 0,
    high = trip.timestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trip.timestamps[middle] <= minute) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(0, low - 1);
  const from = trip.path[index];
  if (index === trip.path.length - 1 || minute <= trip.timestamps[0])
    return [from[0], from[1]];
  const ratio =
    (minute - trip.timestamps[index]) /
    (trip.timestamps[index + 1] - trip.timestamps[index]);
  const to = trip.path[index + 1];
  return [
    from[0] + ratio * (to[0] - from[0]),
    from[1] + ratio * (to[1] - from[1]),
  ];
}

function trailAt(
  trip: AgentTrip,
  minute: number,
  duration: number,
  samples: number,
): TrailPoint[] {
  const start = Math.max(trip.visibleEntryMin, minute - duration);
  const end = Math.min(minute, trip.timestamps[trip.timestamps.length - 1]);
  if (end <= start) return [];
  const trail: TrailPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const time =
      i === samples - 1 ? end : start + ((end - start) * i) / (samples - 1);
    const position = positionAt(trip, time);
    const point = {
      position,
      minute: time,
      opacity: Math.max(0, Math.min(1, 1 - (minute - time) / duration)),
    };
    const previous = trail.at(-1);
    // Stationary door samples do not imply repeated movement or a growing trail.
    if (
      previous &&
      previous.position[0] === position[0] &&
      previous.position[1] === position[1]
    )
      trail[trail.length - 1] = point;
    else trail.push(point);
  }
  return trail.length > 1 ? trail : [];
}

/**
 * Pure presentation adapter for existing SIM-4 approximate trips and engine events.
 * The caller owns one clock. No randomness, timer, rendering, API call or rerun.
 */
export function sampleTripFrame(
  trips: readonly AgentTrip[],
  run: Run,
  minute: number,
  { trailMinutes = 1, trailSamples = 8 }: TripFrameOptions = {},
): TripFrame {
  if (
    !Number.isFinite(minute) ||
    !Number.isFinite(trailMinutes) ||
    trailMinutes <= 0 ||
    !Number.isInteger(trailSamples) ||
    trailSamples < 2 ||
    trailSamples > 64 ||
    !Number.isFinite(run.metrics.closeMin)
  )
    throw new RangeError(
      "Playback requires a finite minute, positive trail duration and 2–64 integer trail samples",
    );
  const arrivals = new Map<string, number>();
  const outcomes = new Map<string, SampledAgent["outcome"]>();
  let previous = -Infinity;
  for (const event of run.events) {
    if (!Number.isFinite(event.timeMin) || event.timeMin < previous)
      throw new RangeError(
        "Playback events must have finite chronological timestamps",
      );
    previous = event.timeMin;
    if (event.type === "arrival") {
      if (arrivals.has(event.customerId))
        throw new RangeError("Duplicate recorded customer arrival");
      arrivals.set(event.customerId, event.timeMin);
    }
    if (event.timeMin > minute) continue;
    if (event.type === "arrival" && event.decision === "leave")
      outcomes.set(event.customerId, "balked");
    else if (event.type === "completion")
      outcomes.set(event.customerId, "served");
    else if (event.type === "abandonment")
      outcomes.set(event.customerId, "reneged");
  }
  const replay = replayAt(run.events, minute);
  const waiting = new Set(replay.waiting);
  const serving = new Set(replay.serving.map(([id]) => id));
  const ids = new Set<string>();
  const agents: SampledAgent[] = [];
  for (const trip of trips) {
    if (ids.has(trip.customerId))
      throw new RangeError(
        "Duplicate customer trip would create duplicate markers",
      );
    ids.add(trip.customerId);
    validateTrip(trip, arrivals);
    const end = trip.timestamps[trip.timestamps.length - 1];
    if (
      minute < trip.visibleEntryMin ||
      (trip.departureIndex !== null && minute > end)
    )
      continue;
    const outcome = outcomes.get(trip.customerId) ?? null;
    const phase =
      outcome !== null
        ? "outbound"
        : serving.has(trip.customerId)
          ? "in_service"
          : waiting.has(trip.customerId)
            ? "waiting"
            : minute < trip.timestamps[trip.doorArrivalIndex]
              ? "inbound"
              : null;
    if (!phase)
      throw new RangeError(
        `Trip ${trip.customerId} has no matching replay state at the door`,
      );
    agents.push({
      customerId: trip.customerId,
      personaId: trip.personaId,
      kind: trip.kind,
      mode: trip.mode,
      position: positionAt(trip, minute),
      phase,
      outcome,
      heldAtClose:
        trip.departureIndex === null && minute > run.metrics.closeMin,
      trail: trailAt(trip, minute, trailMinutes, trailSamples),
      approximation: trip.geometry.approximation,
      sources: trip.geometry.sources,
    });
  }
  return {
    minute,
    agents,
    queueLength: replay.waiting.length,
    served: replay.served,
    left: replay.left,
    arrivals: replay.arrivals.size,
  };
}
