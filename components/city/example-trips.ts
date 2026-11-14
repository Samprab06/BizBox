/**
 * HAC-77: modeled walking trips for the labelled simulator Example.
 *
 * The fixture sites carry a real map point but no door, frontage or customer
 * origins. Rather than invent those silently, every assumption below is marked
 * `provenance: "assumed"` with a source string, so the trips read as modeled
 * movement around the site, not observed pedestrian traffic.
 */
import type { ArrivalSchedule, DayResult } from "@/lib/sim/contracts";
import { buildTrips, type AgentTrip, type TripPersona } from "@/lib/sim/trips";

/** Half-length of the assumed sidewalk frontage on each side of the door. */
export const EXAMPLE_FRONTAGE_METERS = 120;
const METERS_PER_DEGREE_LAT = 111_320;

export const exampleTripsLabel =
  "Assumed walking approach along the street; not observed traffic.";

export function exampleTrips(
  schedule: ArrivalSchedule,
  run: DayResult,
  site: { longitude: number; latitude: number },
): AgentTrip[] {
  const offset = EXAMPLE_FRONTAGE_METERS / METERS_PER_DEGREE_LAT;
  const door = [site.longitude, site.latitude] as const;
  const personas: TripPersona[] = [
    ...new Set(schedule.customers.map((customer) => customer.personaId)),
  ].map((id) => ({ id, commuteMode: "walk", kind: "passby" }));
  return buildTrips(
    schedule,
    personas,
    run,
    {
      id: schedule.siteId,
      door: {
        value: door,
        provenance: "provided",
        source: "Example site map point (site fixture)",
      },
      streetBearingDeg: {
        value: 0,
        provenance: "assumed",
        source: "Example: street assumed to run north–south",
      },
      frontage: {
        value: [
          [site.longitude, site.latitude - offset],
          [site.longitude, site.latitude + offset],
        ],
        provenance: "assumed",
        source: `Example: ${EXAMPLE_FRONTAGE_METERS * 2} m sidewalk assumed through the door`,
      },
    },
    schedule.seed,
  );
}
