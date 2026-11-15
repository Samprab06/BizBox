import { describe, expect, it } from "vitest";
import { makeDemo, makeDemoInputs } from "@/components/simulator/fixture";
import { buildTrips } from "@/lib/sim/trips";
import { followTarget } from "./follow";
import { sampleTripFrame } from "./trip-frame";

const { schedule } = makeDemoInputs();
const run = makeDemo()[0].run;
const trips = buildTrips(
  schedule,
  [{ id: "morning-visitor", kind: "passby", commuteMode: "walk" }],
  run,
  {
    id: run.siteId,
    door: { value: [-95.39, 29.74], provenance: "assumed", source: "test" },
    streetBearingDeg: { value: 0, provenance: "assumed", source: "test" },
    frontage: {
      value: [
        [-95.39, 29.739],
        [-95.39, 29.741],
      ],
      provenance: "assumed",
      source: "test",
    },
  },
  7,
);

describe("followTarget", () => {
  it("keeps the followed customer framed through the whole trip", () => {
    for (const trip of trips.slice(0, 20)) {
      const end = trip.timestamps.at(-1)!;
      const last =
        trip.departureIndex === null ? run.metrics.closeMin + 5 : end;
      for (
        let minute = trip.visibleEntryMin;
        minute <= last;
        minute += (last - trip.visibleEntryMin) / 40 || 1
      ) {
        const target = followTarget(trips, run, trip.customerId, minute);
        expect(target.status).toBe("following");
        if (target.status !== "following") continue;
        const marker = sampleTripFrame(trips, run, minute).agents.find(
          (agent) => agent.customerId === trip.customerId,
        )!;
        // The camera target is the drawn marker, so the agent stays in view.
        expect(target.position).toEqual(marker.position);
        expect(target.phase).toBe(marker.phase);
      }
    }
  });

  it("reports why there is nothing to follow instead of guessing", () => {
    const trip = trips.find((t) => t.departureIndex !== null)!;
    expect(followTarget(undefined, run, trip.customerId, 500)).toEqual({
      status: "no_trip",
    });
    expect(
      followTarget(trips, run, trip.customerId, trip.visibleEntryMin - 1),
    ).toEqual({ status: "not_visible_yet" });
    const ended = followTarget(
      trips,
      run,
      trip.customerId,
      trip.timestamps.at(-1)! + 1,
    );
    expect(ended.status).toBe("trip_ended");
  });
});
