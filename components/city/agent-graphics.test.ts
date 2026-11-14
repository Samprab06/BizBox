import { describe, expect, it } from "vitest";
import { replayAt } from "@/components/replay/replay-state";
import { makeDemo, makeDemoInputs } from "@/components/simulator/fixture";
import {
  agentColor,
  agentColors,
  agentGraphics,
  queueRadiusMeters,
} from "./agent-graphics";
import { EXAMPLE_FRONTAGE_METERS, exampleTrips } from "./example-trips";
import { sampleTripFrame } from "./trip-frame";

const site = { longitude: -95.3914, latitude: 29.7458 };
const door = [site.longitude, site.latitude] as const;
const { schedule } = makeDemoInputs();
const run = makeDemo()[0].run;
const trips = exampleTrips(schedule, run, site);
const frameAt = (minute: number) => sampleTripFrame(trips, run, minute);

describe("example trips", () => {
  it("builds one modeled trip per scheduled customer, ending at the site door", () => {
    expect(trips).toHaveLength(schedule.customers.length);
    for (const trip of trips) {
      const [lng, lat] = trip.path[trip.doorArrivalIndex];
      expect(lng).toBeCloseTo(site.longitude, 6);
      expect(lat).toBeCloseTo(site.latitude, 6);
    }
  });

  it("labels the street and frontage as assumptions", () => {
    const sources = trips[0].geometry.sources;
    const assumed = sources.filter((s) => s.provenance === "assumed");
    expect(assumed.map((s) => s.role).sort()).toEqual(["bearing", "frontage"]);
    expect(assumed.every((s) => s.source.startsWith("Example:"))).toBe(true);
    expect(sources.find((s) => s.role === "door")?.provenance).toBe("provided");
  });

  it("keeps walkers on the assumed frontage", () => {
    const maxLat = (EXAMPLE_FRONTAGE_METERS + 1) / 111_320;
    for (const trip of trips)
      for (const [lng, lat] of trip.path) {
        expect(Math.abs(lng - site.longitude)).toBeLessThan(1e-9);
        expect(Math.abs(lat - site.latitude)).toBeLessThanOrEqual(maxLat);
      }
  });

  it("is deterministic", () => {
    expect(exampleTrips(schedule, run, site)).toEqual(trips);
  });
});

describe("agent graphics", () => {
  it("draws the same positions for the same minute, whatever was seeked before", () => {
    const first = agentGraphics(frameAt(545), door);
    agentGraphics(frameAt(700), door);
    agentGraphics(frameAt(481), door);
    expect(agentGraphics(frameAt(545), door)).toEqual(first);
    expect(first.agents.length).toBeGreaterThan(0);
  });

  it("agrees with the replay totals at every minute, so speed cannot change them", () => {
    for (const minute of [480, 520, 600, 650, 719, 720, 760]) {
      const frame = frameAt(minute);
      const replay = replayAt(run.events, minute);
      expect(frame.served).toBe(replay.served);
      expect(frame.left).toBe(replay.left);
      expect(frame.queueLength).toBe(replay.waiting.length);
    }
  });

  it("never reveals an outcome before it happens", () => {
    const leaver = trips.find(
      (trip) => trip.outcome === "balked" || trip.outcome === "reneged",
    );
    expect(leaver).toBeDefined();
    const arrival = leaver!.timestamps[leaver!.doorArrivalIndex];
    const before = frameAt(arrival - 0.5).agents.find(
      (agent) => agent.customerId === leaver!.customerId,
    );
    if (before) expect(agentColor(before)).not.toBe(agentColors.left);
  });

  it("colors by event-visible phase and outcome", () => {
    const colors = new Set(
      [500, 560, 620, 700].flatMap((minute) =>
        agentGraphics(frameAt(minute), door).agents.map((a) => a.color),
      ),
    );
    for (const color of colors)
      expect(Object.values(agentColors)).toContain(color);
  });

  it("sizes the door ring by the current line and hides it when empty", () => {
    expect(queueRadiusMeters(0)).toBe(0);
    expect(queueRadiusMeters(4)).toBeGreaterThan(queueRadiusMeters(1));
    const busy = [520, 560, 600, 640]
      .map((minute) => agentGraphics(frameAt(minute), door))
      .find((graphics) => graphics.queue);
    expect(busy?.queue?.center).toEqual(door);
    expect(busy?.queue?.radiusMeters).toBe(
      queueRadiusMeters(busy!.queue!.length),
    );
    expect(agentGraphics(frameAt(470), door).queue).toBeNull();
  });
});
