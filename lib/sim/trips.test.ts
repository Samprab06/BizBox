import { describe, expect, it } from "vitest";
import type {
  ArrivalSchedule,
  Customer,
  DayResult,
  SiteConfigInput,
} from "./contracts";
import { simulateDay } from "./engine";
import {
  buildTrips,
  type TripGeometry,
  type TripPersona,
  type TripSite,
} from "./trips";

const customer = (
  id: string,
  arrivalMin: number,
  serviceMin: number,
  personaId = "resident",
): Customer => ({ id, arrivalMin, serviceMin, personaId, stayDraw: 0.5 });

function simulate(
  customers: Customer[],
  openMin = 480,
  closeMin = 540,
  stations = 1,
): { schedule: ArrivalSchedule; day: DayResult } {
  const schedule: ArrivalSchedule = {
    siteId: "site",
    seed: 1,
    dayType: "weekday",
    openMin,
    closeMin,
    demandSource: "huff",
    customers,
    params: {},
    stayCurves: ["resident", "worker", "passby", "never"].map((personaId) => ({
      personaId,
      points: [{ lineLength: 0, p: personaId === "never" ? 0 : 1 }],
    })),
  };
  const config: SiteConfigInput = {
    hours: { weekday: { openMin, closeMin }, weekend: { openMin, closeMin } },
    stations: { planned: stations, usableSf: 1000, sfPerStation: 100 },
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
    calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
  };
  return { schedule, day: simulateDay(schedule, config) };
}

const geometry = <T>(value: T): TripGeometry<T> => ({
  value,
  provenance: "assumed",
  source: "Offline test fixture",
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
    [
      [0.02, -0.02],
      [0.02, 0.02],
    ],
  ]),
};
const personas: TripPersona[] = [
  {
    id: "resident",
    kind: "resident",
    commuteMode: "walk",
    blockGroup: geometry({
      type: "Polygon",
      coordinates: [
        [
          [-0.01, 0.001],
          [-0.005, 0.001],
          [-0.005, 0.006],
          [-0.01, 0.006],
          [-0.01, 0.001],
        ],
      ],
    }),
  },
  {
    id: "worker",
    kind: "worker",
    commuteMode: "drive",
    workplace: geometry([-0.01, 0.01]),
    jitterMeters: 40,
  },
  { id: "passby", kind: "passby", commuteMode: "walk" },
  { id: "never", kind: "passby", commuteMode: "walk" },
];

const meters = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320);

describe("buildTrips", () => {
  it("matches engine outcomes, arrival times, service waits and closure without losing customers", () => {
    const { schedule, day } = simulate([
      customer("a", 480, 10),
      customer("b", 485, 10, "worker"),
      customer("c", 486, 1, "never"),
      customer("d", 487, 35),
      customer("e", 488, 1, "passby"),
      customer("f", 537, 10, "worker"),
      customer("g", 538, 1),
      customer("outside", 540, 1),
      customer("early", 479, 1),
    ]);
    const trips = buildTrips(schedule, personas, day, site, 42);
    expect(trips).toHaveLength(7);
    expect(
      trips.map(({ customerId, outcome }) => [customerId, outcome]),
    ).toEqual([
      ["a", "served"],
      ["b", "served"],
      ["c", "balked"],
      ["d", "served"],
      ["e", "reneged"],
      ["f", "open"],
      ["g", "open"],
    ]);
    for (const trip of trips) {
      expect(trip.path[trip.doorArrivalIndex]).toEqual([0, 0]);
      expect(trip.timestamps[trip.doorArrivalIndex]).toBe(
        day.events.find(
          (e) => e.customerId === trip.customerId && e.type === "arrival",
        )!.timeMin,
      );
      expect(trip.path).toHaveLength(trip.timestamps.length);
      expect(
        trip.timestamps.every(
          (time, i) => i === 0 || time >= trip.timestamps[i - 1],
        ),
      ).toBe(true);
      if (trip.outcome === "open") {
        expect(trip.departureIndex).toBeNull();
        expect(trip.path.at(-1)).toEqual([0, 0]);
        expect(trip.timestamps.at(-1)).toBe(540);
      } else {
        const terminal = day.events.find(
          (e) =>
            e.customerId === trip.customerId &&
            (e.type === "completion" ||
              e.type === "abandonment" ||
              (e.type === "arrival" && e.decision === "leave")),
        )!;
        expect(trip.timestamps[trip.departureIndex!]).toBe(terminal.timeMin);
      }
    }
    const b = trips[1];
    expect(
      b.timestamps.slice(b.doorArrivalIndex, b.departureIndex! + 1),
    ).toEqual([485, 490, 500]);
    expect(b.path.slice(b.doorArrivalIndex, b.departureIndex! + 1)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it("uses fixed walk/drive speeds, including offscreen origin-to-arterial travel", () => {
    const { schedule, day } = simulate([
      customer("a", 480, 1),
      customer("b", 500, 1, "worker"),
    ]);
    const [walker, driver] = buildTrips(schedule, personas, day, site, 42);
    expect(walker.originDepartureMin).toBe(walker.visibleEntryMin);
    expect(walker.visibleEntryMin).toBe(walker.timestamps[0]);
    expect(driver.visibleEntryMin).toBe(driver.timestamps[0]);
    expect(walker.path[0]).toEqual(walker.origin);
    expect(driver.path[0][0]).toBeCloseTo(-0.002, 12);
    expect(driver.visibleEntryMin).toBeGreaterThan(driver.originDepartureMin);
    const offscreenDistance =
      (Math.abs(driver.origin[0] - driver.path[0][0]) +
        Math.abs(driver.origin[1] - driver.path[0][1])) *
      111320;
    expect(driver.visibleEntryMin - driver.originDepartureMin).toBeCloseTo(
      offscreenDistance / 400,
      10,
    );
    for (const [trip, speed] of [
      [walker, 80],
      [driver, 400],
    ] as const) {
      for (let i = 1; i <= trip.doorArrivalIndex; i++) {
        expect(trip.timestamps[i] - trip.timestamps[i - 1]).toBeCloseTo(
          meters(trip.path[i], trip.path[i - 1]) / speed,
          10,
        );
      }
    }
    expect(
      Math.hypot(
        (driver.origin[0] + 0.01) * 111320,
        (driver.origin[1] - 0.01) * 111320,
      ),
    ).toBeLessThanOrEqual(40);
  });

  it("samples residents inside polygon boundaries while excluding holes", () => {
    const resident: TripPersona = {
      id: "resident",
      kind: "resident",
      commuteMode: "walk",
      blockGroup: geometry({
        type: "Polygon",
        coordinates: [
          [
            [-0.01, -0.01],
            [0.01, -0.01],
            [0.01, 0.01],
            [-0.01, 0.01],
            [-0.01, -0.01],
          ],
          [
            [-0.005, -0.005],
            [0.005, -0.005],
            [0.005, 0.005],
            [-0.005, 0.005],
            [-0.005, -0.005],
          ],
        ],
      }),
    };
    const { schedule, day } = simulate(
      Array.from({ length: 64 }, (_, i) => customer(`c${i}`, 480 + i / 10, 0)),
    );
    for (const {
      origin: [lng, lat],
    } of buildTrips(schedule, [resident], day, site, 123)) {
      expect(Math.abs(lng)).toBeLessThan(0.01);
      expect(Math.abs(lat)).toBeLessThan(0.01);
      expect(Math.abs(lng) > 0.005 || Math.abs(lat) > 0.005).toBe(true);
    }
    const multi: TripPersona = {
      ...resident,
      blockGroup: geometry({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0.01, 0.01],
              [0.02, 0.01],
              [0.02, 0.02],
              [0.01, 0.02],
              [0.01, 0.01],
            ],
          ],
          [
            [
              [-0.02, -0.02],
              [-0.01, -0.02],
              [-0.01, -0.01],
              [-0.02, -0.01],
              [-0.02, -0.02],
            ],
          ],
        ],
      }),
    };
    const trips = buildTrips(schedule, [multi], day, site, 123);
    expect(
      trips.every(
        ({ origin: [x, y] }) =>
          (x > 0.01 && x < 0.02 && y > 0.01 && y < 0.02) ||
          (x > -0.02 && x < -0.01 && y > -0.02 && y < -0.01),
      ),
    ).toBe(true);
    expect(new Set(trips.map(({ origin }) => Math.sign(origin[0]))).size).toBe(
      2,
    );
  });

  it("keeps deterministic per-customer trips across input permutations without mutation", () => {
    const { schedule, day } = simulate([
      customer("b", 485, 1, "worker"),
      customer("a", 480, 1),
      customer("c", 490, 1, "passby"),
    ]);
    const before = JSON.stringify({ schedule, day, site, personas });
    const trips = buildTrips(schedule, personas, day, site, 42);
    expect(JSON.stringify(buildTrips(schedule, personas, day, site, 42))).toBe(
      JSON.stringify(trips),
    );
    expect(
      buildTrips(
        { ...schedule, customers: [...schedule.customers].reverse() },
        [...personas].reverse(),
        day,
        site,
        42,
      ),
    ).toEqual(trips);
    expect(
      buildTrips(schedule, personas, day, site, 43).map((trip) => trip.origin),
    ).not.toEqual(trips.map((trip) => trip.origin));
    expect(JSON.stringify({ schedule, day, site, personas })).toBe(before);
  });

  it("continues passby trips to the opposite frontage endpoint", () => {
    const { schedule, day } = simulate([customer("a", 480, 1, "passby")]);
    const [trip] = buildTrips(schedule, personas, day, site, 42);
    expect(trip.origin[1]).toBe(0);
    expect(trip.path.at(-1)).toEqual(
      trip.origin[0] < 0 ? [0.01, 0] : [-0.01, 0],
    );
    expect(trip.geometry.approximation).toBe("local_rotated_grid");
    expect(
      trip.geometry.sources.every((source) => source.provenance === "assumed"),
    ).toBe(true);
  });

  it("requires explicit speeds for transit and bike, preserves modes and rotates the grid", () => {
    const { schedule, day } = simulate([customer("a", 480, 1)]);
    for (const commuteMode of ["bike", "transit"] as const) {
      const adapted = { ...personas[0], commuteMode };
      expect(() => buildTrips(schedule, [adapted], day, site, 1)).toThrow(
        /speed/i,
      );
      const [trip] = buildTrips(
        schedule,
        [adapted],
        day,
        {
          ...site,
          streetBearingDeg: geometry(45),
          modeSpeeds: { [commuteMode]: 100 },
        },
        1,
      );
      expect(trip.mode).toBe(commuteMode);
      const [start, corner] = trip.path;
      expect(Math.abs(corner[0] - start[0])).toBeCloseTo(
        Math.abs(corner[1] - start[1]),
        10,
      );
      expect(trip.timestamps[1] - trip.timestamps[0]).toBeCloseTo(
        meters(start, corner) / 100,
        10,
      );
    }
  });

  it("handles completion at midnight, ties, zero-duration service and negative departure times", () => {
    const { schedule, day } = simulate(
      [customer("a", 0, 1440), customer("b", 0, 0)],
      0,
      1440,
      2,
    );
    const trips = buildTrips(schedule, personas, day, site, 0);
    expect(trips[0].timestamps[trips[0].departureIndex!]).toBe(1440);
    expect(
      trips[1].timestamps.slice(
        trips[1].doorArrivalIndex,
        trips[1].departureIndex! + 1,
      ),
    ).toEqual([0, 0, 0]);
    expect(trips[0].originDepartureMin).toBeLessThan(0);
    expect(trips.map(({ outcome }) => outcome)).toEqual(["served", "served"]);
  });

  it("uses latitude-scaled longitude at Houston and preserves door coordinates exactly", () => {
    const door = [-95.3905, 29.7425] as const;
    const houston: TripSite = {
      id: "site",
      door: geometry(door),
      streetBearingDeg: geometry(25),
    };
    const person: TripPersona = {
      id: "worker",
      kind: "worker",
      commuteMode: "walk",
      workplace: geometry([-95.4, 29.75]),
      jitterMeters: 0,
    };
    const { schedule, day } = simulate([customer("a", 480, 1, "worker")]);
    const [trip] = buildTrips(schedule, [person], day, houston, 42);
    expect(trip.path[trip.doorArrivalIndex]).toEqual(door);
    for (let i = 1; i < trip.path.length; i++) {
      const a = trip.path[i - 1],
        b = trip.path[i];
      const d = Math.hypot(
        (a[0] - b[0]) * 111320 * Math.cos((29.7425 * Math.PI) / 180),
        (a[1] - b[1]) * 111320,
      );
      if (d > 0)
        expect(trip.timestamps[i] - trip.timestamps[i - 1]).toBeCloseTo(
          d / 80,
          8,
        );
    }
    expect(trip.visibleEntryMin).toBe(trip.timestamps[0]);
    expect(trip.geometry.speedMetersPerMin).toBe(80);
    expect(trip.geometry.workerJitterMeters).toBe(0);
  });

  it("does not claim passby drivers return offscreen to their original approach point", () => {
    const { schedule, day } = simulate([customer("a", 480, 1, "passby")]);
    const person: TripPersona = {
      id: "passby",
      kind: "passby",
      commuteMode: "drive",
    };
    const [trip] = buildTrips(schedule, [person], day, site, 42);
    expect(trip.path.at(-1)).toEqual(
      trip.origin[0] < 0 ? [0.01, 0] : [-0.01, 0],
    );
    expect(trip.geometry.offscreenReturnMinutes).toBe(0);
  });

  it("rejects degenerate rings and invalid holes reproducibly instead of inventing an origin", () => {
    const { schedule, day } = simulate([customer("a", 480, 1)]);
    const badRings = [
      [
        [
          [0, 0],
          [0.01, 0],
          [0.02, 0],
          [0, 0],
        ],
      ],
      [
        [
          [0, 0],
          [0.01, 0.01],
          [0, 0.01],
          [0.01, 0],
          [0, 0],
        ],
      ],
      [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.01],
          [0, 0],
        ],
        [
          [0.02, 0.02],
          [0.03, 0.02],
          [0.03, 0.03],
          [0.02, 0.03],
          [0.02, 0.02],
        ],
      ],
      [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.01],
          [0, 0],
        ],
        [
          [0.005, 0.005],
          [0.02, 0.005],
          [0.02, 0.02],
          [0.005, 0.02],
          [0.005, 0.005],
        ],
      ],
    ] as const;
    for (const coordinates of badRings) {
      const person: TripPersona = {
        id: "resident",
        kind: "resident",
        commuteMode: "walk",
        blockGroup: geometry({ type: "Polygon", coordinates }),
      };
      for (const seed of [1, 42])
        expect(() => buildTrips(schedule, [person], day, site, seed)).toThrow(
          /polygon/i,
        );
    }
  });

  it("returns empty trips for no in-hours customers", () => {
    const { schedule, day } = simulate([customer("outside", 540, 1)]);
    expect(buildTrips(schedule, [], day, site, 1)).toEqual([]);
  });

  it("uses engine opening hours and retains a service starting exactly at closing as open", () => {
    const { schedule, day } = simulate(
      [
        customer("a", 510, 30),
        customer("b", 520, 10),
        customer("outside", 540, 1),
      ],
      510,
      540,
    );
    const trips = buildTrips(
      { ...schedule, openMin: 480, closeMin: 600 },
      personas,
      day,
      site,
      42,
    );
    expect(trips.map(({ outcome }) => outcome)).toEqual(["served", "open"]);
    expect(trips[0].timestamps[trips[0].departureIndex!]).toBe(540);
    expect(trips[1].timestamps.slice(trips[1].doorArrivalIndex)).toEqual([
      520, 540, 540,
    ]);
  });

  it("fails bounded sampling of extremely sparse multipolygons without a fallback", () => {
    const { schedule, day } = simulate([customer("a", 480, 1)]);
    const tiny = (x: number) =>
      [
        [x, x],
        [x + 1e-9, x],
        [x + 1e-9, x + 1e-9],
        [x, x + 1e-9],
        [x, x],
      ] as const;
    const person: TripPersona = {
      id: "resident",
      kind: "resident",
      commuteMode: "walk",
      blockGroup: geometry({
        type: "MultiPolygon",
        coordinates: [[tiny(-0.5)], [tiny(0.5)]],
      }),
    };
    expect(() => buildTrips(schedule, [person], day, site, 42)).toThrow(
      /sample.*10000/i,
    );
    expect(() => buildTrips(schedule, [person], day, site, 42)).toThrow(
      /sample.*10000/i,
    );
  });

  it("rejects absent or malformed source geometry and mismatched engine evidence", () => {
    const { schedule, day } = simulate([customer("a", 480, 1)]);
    expect(() => buildTrips(schedule, [], day, site, 1)).toThrow(/persona/i);
    expect(() =>
      buildTrips(schedule, personas, { ...day, events: [] }, site, 1),
    ).toThrow(/arrival/i);
    expect(() =>
      buildTrips(schedule, personas, day, { ...site, id: "other" }, 1),
    ).toThrow(/site/i);
    expect(() =>
      buildTrips(
        schedule,
        [
          {
            ...personas[0],
            kind: "resident",
            blockGroup: geometry({ type: "Polygon", coordinates: [] }),
          },
        ],
        day,
        site,
        1,
      ),
    ).toThrow(/polygon/i);
    const driving = simulate([customer("a", 480, 1, "worker")]);
    expect(() =>
      buildTrips(
        driving.schedule,
        personas,
        driving.day,
        { ...site, arterials: undefined },
        1,
      ),
    ).toThrow(/arterial/i);
    const passing = simulate([customer("a", 480, 1, "passby")]);
    expect(() =>
      buildTrips(
        passing.schedule,
        personas,
        passing.day,
        { ...site, frontage: undefined },
        1,
      ),
    ).toThrow(/frontage/i);
  });
});
