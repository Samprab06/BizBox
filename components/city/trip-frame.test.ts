import { describe, expect, it } from "vitest";
import { replayAt } from "@/components/replay/replay-state";
import type {
  ArrivalSchedule,
  DayResult,
  SiteConfigInput,
} from "@/lib/sim/contracts";
import { simulateDay } from "@/lib/sim/engine";
import {
  buildTrips,
  type AgentTrip,
  type TripGeometry,
  type TripPersona,
  type TripSite,
} from "@/lib/sim/trips";
import { sampleTripFrame } from "./trip-frame";

const geometry = <T>(value: T): TripGeometry<T> => ({
  value,
  provenance: "assumed",
  source: "Invented offline sampler fixture",
});
const site: TripSite = {
  id: "site",
  door: geometry([0, 0]),
  streetBearingDeg: geometry(0),
  frontage: geometry([
    [-0.01, 0],
    [0.01, 0],
  ]),
  arterials: geometry([
    [
      [-0.002, -0.02],
      [-0.002, 0.02],
    ],
  ]),
};
const personas: TripPersona[] = [
  {
    id: "walker",
    kind: "worker",
    commuteMode: "walk",
    workplace: geometry([-0.005, 0.005]),
    jitterMeters: 0,
  },
  {
    id: "driver",
    kind: "worker",
    commuteMode: "drive",
    workplace: geometry([-0.01, 0.005]),
    jitterMeters: 0,
  },
  { id: "balker", kind: "passby", commuteMode: "walk" },
];
function fixture(
  customers?: ArrivalSchedule["customers"],
  hours = { openMin: 480, closeMin: 540 },
): { day: DayResult; trips: AgentTrip[] } {
  const schedule: ArrivalSchedule = {
    ...hours,
    siteId: "site",
    seed: 42,
    dayType: "weekday",
    demandSource: "huff",
    params: {},
    stayCurves: personas.map((p) => ({
      personaId: p.id,
      points: [{ lineLength: 0, p: p.id === "balker" ? 0 : 1 }],
    })),
    customers: customers ?? [
      {
        id: "served",
        personaId: "walker",
        arrivalMin: 480,
        serviceMin: 10,
        stayDraw: 0,
      },
      {
        id: "queued",
        personaId: "driver",
        arrivalMin: 481,
        serviceMin: 10,
        stayDraw: 0,
      },
      {
        id: "balked",
        personaId: "balker",
        arrivalMin: 482,
        serviceMin: 1,
        stayDraw: 0.5,
      },
      {
        id: "zero",
        personaId: "walker",
        arrivalMin: 510,
        serviceMin: 0,
        stayDraw: 0,
      },
      {
        id: "open",
        personaId: "walker",
        arrivalMin: 539,
        serviceMin: 10,
        stayDraw: 0,
      },
    ],
  };
  const config: SiteConfigInput = {
    hours: { weekday: hours, weekend: hours },
    stations: { planned: 1, usableSf: 1000, sfPerStation: 100 },
    service: { meanServiceMin: 10 },
    prices: { avgTicketUsd: 10 },
    staff: { headcount: 1, wageUsdPerHour: 20 },
    costs: { cogsPctOfRevenue: 0.3 },
    lease: {
      sf: 1000,
      askingRentUsdPerSfYear: 20,
      tripleNet: false,
      buildoutUsd: 0,
      leaseTermMonths: 12,
    },
    calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 0 },
  };
  const day = simulateDay(schedule, config);
  return { day, trips: buildTrips(schedule, personas, day, site, 42) };
}
const find = (frame: ReturnType<typeof sampleTripFrame>, id: string) =>
  frame.agents.find((a) => a.customerId === id)!;

describe("shared-clock trip playback", () => {
  it("interpolates the actual SIM-4 visible path before opening without clamping the clock", () => {
    const { day, trips } = fixture();
    const trip = trips[0];
    const minute = (trip.timestamps[0] + trip.timestamps[1]) / 2;
    const frame = sampleTripFrame(trips, day, minute);
    expect(frame.minute).toBe(minute);
    expect(minute).toBeLessThan(day.metrics.openMin);
    const agent = find(frame, trip.customerId);
    expect(agent.phase).toBe("inbound");
    expect(agent.outcome).toBeNull();
    expect(agent.position[0]).toBeCloseTo(
      (trip.path[0][0] + trip.path[1][0]) / 2,
      12,
    );
    expect(agent.position[1]).toBeCloseTo(
      (trip.path[0][1] + trip.path[1][1]) / 2,
      12,
    );
    expect(agent.approximation).toBe("local_rotated_grid");
    expect(agent.sources).toEqual(trip.geometry.sources);
  });

  it("suppresses offscreen driving before arterial entry and after the visible return", () => {
    const { day, trips } = fixture();
    const trip = trips.find((t) => t.customerId === "queued")!;
    expect(trip.geometry.offscreenInboundMinutes).toBeGreaterThan(0);
    const hiddenMinute = (trip.originDepartureMin + trip.visibleEntryMin) / 2;
    expect(
      find(sampleTripFrame(trips, day, hiddenMinute), trip.customerId),
    ).toBeUndefined();
    expect(
      find(sampleTripFrame(trips, day, trip.visibleEntryMin), trip.customerId)
        .position,
    ).toEqual(trip.path[0]);
    expect(
      find(
        sampleTripFrame(trips, day, trip.timestamps.at(-1)!),
        trip.customerId,
      ).position,
    ).toEqual(trip.path.at(-1));
    expect(
      find(
        sampleTripFrame(trips, day, trip.timestamps.at(-1)! + 0.001),
        trip.customerId,
      ),
    ).toBeUndefined();
  });

  it("uses replayAt queue membership and reveals outcomes only at their events", () => {
    const { day, trips } = fixture();
    for (const minute of [479, 480, 481, 482, 489.999, 490, 500, 540]) {
      const frame = sampleTripFrame(trips, day, minute);
      const replay = replayAt(day.events, minute);
      expect(frame.queueLength).toBe(replay.waiting.length);
      expect(frame.served).toBe(replay.served);
      expect(frame.left).toBe(replay.left);
      expect(frame.arrivals).toBe(replay.arrivals.size);
    }
    expect(find(sampleTripFrame(trips, day, 489), "served")).toMatchObject({
      phase: "in_service",
      outcome: null,
    });
    expect(find(sampleTripFrame(trips, day, 490), "served")).toMatchObject({
      phase: "outbound",
      outcome: "served",
    });
    expect(
      find(sampleTripFrame(trips, day, 481.999), "balked").outcome,
    ).toBeNull();
    expect(find(sampleTripFrame(trips, day, 482), "balked").outcome).toBe(
      "balked",
    );
    expect(find(sampleTripFrame(trips, day, 481), "queued").phase).toBe(
      "waiting",
    );
  });

  it("handles equal door timestamps and zero-duration service without division by zero", () => {
    const { day, trips } = fixture();
    const trip = trips.find((t) => t.customerId === "zero")!;
    expect(
      trip.timestamps.slice(trip.doorArrivalIndex, trip.departureIndex! + 1),
    ).toEqual([510, 510, 510]);
    const agent = find(sampleTripFrame(trips, day, 510), "zero");
    expect(agent).toMatchObject({
      position: [0, 0],
      phase: "outbound",
      outcome: "served",
    });
    expect(
      agent.trail.every(
        (p) => p.position.every(Number.isFinite) && Number.isFinite(p.opacity),
      ),
    ).toBe(true);
  });

  it("holds open customers at their last known door state without inventing a terminal outcome", () => {
    const { day, trips } = fixture();
    expect(
      trips.find((t) => t.customerId === "open")!.departureIndex,
    ).toBeNull();
    expect(find(sampleTripFrame(trips, day, 540), "open")).toMatchObject({
      position: [0, 0],
      phase: "in_service",
      outcome: null,
      heldAtClose: false,
    });
    expect(find(sampleTripFrame(trips, day, 550), "open")).toMatchObject({
      position: [0, 0],
      phase: "in_service",
      outcome: null,
      heldAtClose: true,
      trail: [],
    });
  });

  it("returns bounded fading historical samples clipped to visible trip time", () => {
    const { day, trips } = fixture();
    const trip = trips[0];
    const minute = trip.visibleEntryMin + 0.5;
    const agent = find(
      sampleTripFrame(trips, day, minute, { trailMinutes: 1, trailSamples: 4 }),
      trip.customerId,
    );
    expect(agent.trail).toHaveLength(4);
    expect(agent.trail[0].minute).toBe(trip.visibleEntryMin);
    expect(agent.trail.at(-1)!.minute).toBe(minute);
    expect(agent.trail[0].opacity).toBeCloseTo(0.5);
    expect(agent.trail.at(-1)!.opacity).toBe(1);
    expect(
      agent.trail.every(
        (p) => p.minute <= minute && p.minute >= trip.visibleEntryMin,
      ),
    ).toBe(true);
  });

  it("is seek-order and speed independent and never mutates source trips or events", () => {
    const { day, trips } = fixture();
    const before = structuredClone({ day, trips });
    const expected = sampleTripFrame(trips, day, 485);
    for (const speed of [1, 6, 18, 60]) {
      sampleTripFrame(trips, day, 485 + speed);
      sampleTripFrame(trips, day, 470);
      expect(sampleTripFrame(trips, day, 485)).toEqual(expected);
    }
    expect({ day, trips }).toEqual(before);
    (expected.agents[0].position as [number, number])[0] = 123;
    expect({ day, trips }).toEqual(before);
  });

  it("reveals a real engine reneged outcome only at its abandonment event", () => {
    const { day, trips } = fixture([
      {
        id: "blocker",
        personaId: "walker",
        arrivalMin: 480,
        serviceMin: 40,
        stayDraw: 0,
      },
      {
        id: "reneged",
        personaId: "driver",
        arrivalMin: 481,
        serviceMin: 10,
        stayDraw: 0,
      },
    ]);
    const trip = trips.find((t) => t.customerId === "reneged")!;
    expect(trip.outcome).toBe("reneged");
    const event = day.events.find(
      (e) => e.customerId === "reneged" && e.type === "abandonment",
    )!;
    expect(
      find(sampleTripFrame(trips, day, event.timeMin - 0.001), "reneged"),
    ).toMatchObject({ phase: "waiting", outcome: null });
    expect(
      find(sampleTripFrame(trips, day, event.timeMin), "reneged"),
    ).toMatchObject({ phase: "outbound", outcome: "reneged" });
  });

  it("keeps an exact-closing service start open while completed customers can leave after close", () => {
    const { day, trips } = fixture([
      {
        id: "completed",
        personaId: "walker",
        arrivalMin: 510,
        serviceMin: 30,
        stayDraw: 0,
      },
      {
        id: "starts-at-close",
        personaId: "driver",
        arrivalMin: 520,
        serviceMin: 10,
        stayDraw: 0,
      },
    ]);
    expect(
      find(sampleTripFrame(trips, day, 539.999), "starts-at-close").phase,
    ).toBe("waiting");
    expect(
      find(sampleTripFrame(trips, day, 540), "starts-at-close"),
    ).toMatchObject({ phase: "in_service", outcome: null });
    expect(
      find(sampleTripFrame(trips, day, 541), "starts-at-close"),
    ).toMatchObject({ phase: "in_service", outcome: null, heldAtClose: true });
    expect(find(sampleTripFrame(trips, day, 541), "completed")).toMatchObject({
      phase: "outbound",
      outcome: "served",
      heldAtClose: false,
    });
  });

  it("preserves negative inbound time and visible departures after midnight", () => {
    const { day, trips } = fixture(
      [
        {
          id: "midnight",
          personaId: "walker",
          arrivalMin: 0,
          serviceMin: 1440,
          stayDraw: 0,
        },
      ],
      { openMin: 0, closeMin: 1440 },
    );
    const inboundMinute = trips[0].visibleEntryMin / 2;
    expect(inboundMinute).toBeLessThan(0);
    expect(
      find(sampleTripFrame(trips, day, inboundMinute), "midnight"),
    ).toMatchObject({ phase: "inbound", outcome: null });
    expect(find(sampleTripFrame(trips, day, 1440), "midnight")).toMatchObject({
      phase: "outbound",
      outcome: "served",
      position: [0, 0],
    });
    expect(find(sampleTripFrame(trips, day, 1441), "midnight").phase).toBe(
      "outbound",
    );
  });

  it("rejects unsafe numeric inputs, duplicate markers and malformed trip timestamps", () => {
    const { day, trips } = fixture();
    for (const minute of [NaN, Infinity, -Infinity])
      expect(() => sampleTripFrame(trips, day, minute)).toThrow(RangeError);
    for (const trailSamples of [0, 1, 1.5, 65, Infinity, NaN])
      expect(() => sampleTripFrame(trips, day, 485, { trailSamples })).toThrow(
        RangeError,
      );
    for (const trailMinutes of [0, -1, Infinity, NaN])
      expect(() => sampleTripFrame(trips, day, 485, { trailMinutes })).toThrow(
        RangeError,
      );
    expect(() => sampleTripFrame([trips[0], trips[0]], day, 485)).toThrow(
      /duplicate/i,
    );
    expect(() =>
      sampleTripFrame([{ ...trips[0], timestamps: [] }], day, 485),
    ).toThrow(RangeError);
    expect(() =>
      sampleTripFrame(
        [
          {
            ...trips[0],
            timestamps: trips[0].timestamps.map((t, i) =>
              i === 1 ? -9999 : t,
            ),
          },
        ],
        day,
        485,
      ),
    ).toThrow(RangeError);
  });

  it("returns no agents and replay's empty counts for an empty scene", () => {
    const { day } = fixture();
    const empty = { ...day, events: [] };
    expect(sampleTripFrame([], empty, -10)).toEqual({
      minute: -10,
      agents: [],
      queueLength: 0,
      served: 0,
      left: 0,
      arrivals: 0,
    });
  });
});
