/**
 * HAC-93 (SIM-9): renderer-agnostic "Follow" target for one customer.
 *
 * A renderer (Cesium city, three.js interior) calls this on every clock tick and points
 * its camera at `position`. It reuses the SIM-4/5 trip sampler, so the followed point is
 * exactly the drawn marker, and it reads no event after `minute`.
 */
import type { DayResult } from "@/lib/sim/contracts";
import type { AgentTrip, Position } from "@/lib/sim/trips";
import { sampleTripFrame, type SampledAgent } from "./trip-frame";

export type FollowTarget =
  | {
      status: "following";
      position: Position;
      phase: SampledAgent["phase"];
    }
  /** No trip geometry for this customer; the renderer keeps its own camera. */
  | { status: "no_trip" }
  /** The trip has not entered the map yet at this minute. */
  | { status: "not_visible_yet" }
  /** The trip has left the map; the camera holds the last framed point. */
  | { status: "trip_ended"; position: Position };

export function followTarget(
  trips: readonly AgentTrip[] | null | undefined,
  run: Pick<DayResult, "events" | "metrics">,
  customerId: string,
  minute: number,
): FollowTarget {
  const trip = trips?.find((entry) => entry.customerId === customerId);
  if (!trip) return { status: "no_trip" };
  if (minute < trip.visibleEntryMin) return { status: "not_visible_yet" };
  const agent = sampleTripFrame([trip], run, minute).agents[0];
  if (!agent) {
    const last = trip.path[trip.path.length - 1];
    return { status: "trip_ended", position: [last[0], last[1]] };
  }
  return { status: "following", position: agent.position, phase: agent.phase };
}
