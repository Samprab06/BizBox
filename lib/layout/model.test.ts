import { describe, expect, it } from "vitest";
import type { Layout, LayoutOp } from "@/lib/contracts/layout";
import { diffScenarios, invertScenarioDiff } from "@/lib/scenario/model";
import { createRootScenario } from "@/lib/scenario/model";
import { simulateDay } from "@/lib/sim/engine";
import {
  applyLayoutOp,
  createLayout,
  createLayoutDiffHook,
  deriveRoomBounds,
  deriveSimParams,
  LayoutInputError,
  parseLayout,
} from "./index";

const source = {
  origin: "agent-proposed" as const,
  evidenceIds: ["fixture-layout"],
};
const solid = (id: string, x: number, y: number, width = 2, depth = 2) => ({
  id,
  footprint: { x, y, width, depth },
  ...source,
});
function input() {
  return {
    layoutId: "l1",
    siteId: "site-1",
    category: "coffee" as Layout["category"],
    room: deriveRoomBounds({
      listing: { areaSqFt: 1600, evidenceIds: ["costar:sf"] },
    }),
    entrance: { id: "entrance", point: { x: 0, y: 10 }, widthFt: 4, ...source },
    counter: solid("counter", 30, 8, 4, 4),
    stations: [{ ...solid("s1", 30, 20), type: "espresso" }],
    seating: [{ ...solid("seat1", 20, 25), seats: 2, dwellMin: 10 }],
    queuePath: {
      id: "queue",
      points: [
        { x: 8, y: 10 },
        { x: 26, y: 10 },
      ],
      ...source,
    },
    backOfHouse: solid("boh", 30, 30, 10, 10),
  };
}
function errors(work: () => unknown) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(LayoutInputError);
    return (error as LayoutInputError).fieldErrors;
  }
  throw new Error("expected layout rejection");
}

describe("room bounds and immutable layout", () => {
  it("distinguishes inferred listing shape from measured scan dimensions", () => {
    const room = deriveRoomBounds({
      listing: { areaSqFt: 1600, evidenceIds: ["sf"] },
    });
    expect(room.bounds).toEqual({ x: 0, y: 0, width: 40, depth: 40 });
    expect(room.origin).toBe("agent-proposed");
    expect(room.areaSource).toEqual({
      value: 1600,
      origin: "costar",
      evidenceIds: ["sf"],
    });
    const scan = deriveRoomBounds({
      matterport: { widthFt: 30, depthFt: 50, evidenceIds: ["scan"] },
      listing: { areaSqFt: 1600, evidenceIds: ["sf"] },
    });
    expect(scan.bounds).toEqual({ x: 0, y: 0, width: 30, depth: 50 });
    expect(scan.origin).toBe("matterport");
    expect(scan.areaSource.value).toBe(1500);
  });
  it.each([0, -1, Infinity, NaN])(
    "rejects invalid room source %s",
    (areaSqFt) => {
      expect(
        errors(() =>
          deriveRoomBounds({ listing: { areaSqFt, evidenceIds: ["sf"] } }),
        ),
      ).toHaveProperty(["sources.listing.areaSqFt"]);
    },
  );
  it("requires a known room source instead of inventing area", () => {
    expect(Object.keys(errors(() => deriveRoomBounds({})))).toContain(
      "sources",
    );
  });
  it("clones and deep-freezes creation and every successful new version", () => {
    const raw = input();
    const parent = createLayout(raw);
    const snapshot = JSON.stringify(parent);
    raw.stations[0].footprint.x = 35;
    expect(parent.stations[0].footprint.x).toBe(30);
    const child = applyLayoutOp(
      parent,
      {
        op: "add_station",
        station: { ...solid("s2", 23, 20), type: "register" },
      },
      { layoutId: "l2" },
    );
    expect(child).toMatchObject({ layoutId: "l2", parentId: "l1" });
    expect(child.stations).toHaveLength(2);
    expect(Object.isFrozen(child.stations[0].footprint)).toBe(true);
    expect(JSON.stringify(parent)).toBe(snapshot);
    expect(child.stations[0]).not.toBe(parent.stations[0]);
  });
  it("moves with new provenance and removes only optional collection elements", () => {
    const parent = createLayout(input());
    const moved = applyLayoutOp(
      parent,
      {
        op: "move",
        elementId: "s1",
        position: { x: 24, y: 20 },
        origin: "founder",
        evidenceIds: ["founder:move"],
      },
      { layoutId: "l2" },
    );
    expect(moved.stations[0]).toMatchObject({
      footprint: { x: 24, y: 20 },
      origin: "founder",
    });
    const removed = applyLayoutOp(
      moved,
      { op: "remove", elementId: "seat1" },
      { layoutId: "l3" },
    );
    expect(removed.seating).toHaveLength(0);
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          { op: "remove", elementId: "counter" },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["op.elementId"]);
  });
  it("rejects reuse of IDs, duplicate elements and unknown move targets without mutation", () => {
    const parent = createLayout(input());
    const snapshot = JSON.stringify(parent);
    const op: LayoutOp = { op: "remove", elementId: "seat1" };
    expect(
      errors(() => applyLayoutOp(parent, op, { layoutId: parent.layoutId })),
    ).toHaveProperty(["meta.layoutId"]);
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          {
            op: "move",
            elementId: "missing",
            position: { x: 2, y: 2 },
            ...source,
          },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["op.elementId"]);
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          { op: "add_station", station: { ...parent.stations[0] } },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["layout.stations.1.id"]);
    expect(JSON.stringify(parent)).toBe(snapshot);
  });
  it("rejects an overlapping move without changing the parent version", () => {
    const parent = createLayout(input());
    const before = JSON.stringify(parent);
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          {
            op: "move",
            elementId: "s1",
            position: { x: 30, y: 8 },
            ...source,
          },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["layout.stations.0.footprint"]);
    expect(JSON.stringify(parent)).toBe(before);
  });
  it("rejects nonfinite coordinates, unknown operation fields, and unrecognized origins", () => {
    const parent = createLayout(input());
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          {
            op: "move",
            elementId: "s1",
            position: { x: Infinity, y: 20 },
            ...source,
          },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["op.position.x"]);
    expect(
      errors(() =>
        applyLayoutOp(
          parent,
          { op: "remove", elementId: "seat1", extra: 1 },
          { layoutId: "l2" },
        ),
      ),
    ).toHaveProperty(["op"]);
    expect(
      errors(() =>
        parseLayout({
          ...parent,
          entrance: { ...parent.entrance, origin: "default" },
        }),
      ),
    ).toHaveProperty(["layout.entrance.origin"]);
  });
});

it("rejects an explicitly null policy instead of replacing invalid input with defaults", () => {
  expect(
    errors(() => createLayout({ ...input(), policy: null })),
  ).toHaveProperty(["layout.policy"]);
});

describe("geometry and capacity validation", () => {
  it("rejects footprints outside the room and overlapping footprints", () => {
    const raw = input();
    raw.stations[0].footprint.x = 39;
    expect(errors(() => createLayout(raw))).toHaveProperty([
      "layout.stations.0.footprint",
    ]);
    raw.stations[0].footprint = { ...raw.counter.footprint };
    expect(errors(() => createLayout(raw))).toHaveProperty([
      "layout.stations.0.footprint",
    ]);
  });
  it("enforces pairwise clearance beyond mere nonoverlap", () => {
    const raw = input();
    raw.stations[0].footprint = { x: 34.5, y: 8, width: 2, depth: 2 };
    expect(errors(() => createLayout(raw))).toHaveProperty([
      "layout.stations.0.footprint",
    ]);
  });
  it("rejects an entrance away from the boundary or too narrow for the route", () => {
    const raw = input();
    raw.entrance.point.x = 5;
    expect(errors(() => createLayout(raw))).toHaveProperty([
      "layout.entrance.point",
    ]);
    raw.entrance.point.x = 0;
    raw.entrance.widthFt = 2;
    expect(errors(() => createLayout(raw))).toHaveProperty([
      "layout.entrance.widthFt",
    ]);
  });
  it("finds a route around obstacles but rejects a solid barrier to the counter", () => {
    const raw = input();
    raw.seating = [];
    raw.queuePath.points = [
      { x: 23, y: 10 },
      { x: 26, y: 10 },
    ];
    raw.stations[0].footprint = { x: 18, y: 5, width: 2, depth: 10 };
    expect(createLayout(raw).layoutId).toBe("l1");
    raw.stations[0].footprint = { x: 18, y: 0, width: 2, depth: 40 };
    raw.queuePath.points = [
      { x: 23, y: 10 },
      { x: 26, y: 10 },
    ];
    expect(errors(() => createLayout(raw))).toHaveProperty(["layout.entrance"]);
  });
  it("uses category SF per station after subtracting back of house", () => {
    const raw = input();
    raw.backOfHouse.footprint = { x: 0, y: 30, width: 40, depth: 10 };
    raw.stations = Array.from({ length: 13 }, (_, i) => ({
      ...solid(`s${i}`, 4 + (i % 7) * 3, 16 + Math.floor(i / 7) * 4, 1, 1),
      type: "register",
    }));
    expect(errors(() => createLayout(raw))).toHaveProperty(["layout.stations"]);
    raw.category = "fitness";
    expect(createLayout(raw).stations).toHaveLength(13);
  });
  it("rejects self-crossing, retraced, out-of-room and obstructed queue paths", () => {
    const paths = [
      [
        { x: 5, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
        { x: 15, y: 5 },
      ],
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 6, y: 5 },
      ],
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 6, y: 5.1 },
      ],
      [
        { x: -1, y: 10 },
        { x: 20, y: 10 },
      ],
      [
        { x: 20, y: 10 },
        { x: 35, y: 10 },
      ],
    ];
    for (const points of paths) {
      expect(
        errors(() =>
          createLayout({
            ...input(),
            queuePath: { ...input().queuePath, points },
          }),
        ),
      ).toHaveProperty(["layout.queuePath.points"]);
    }
  });
  it("derives seat-weighted dwell and zero seating without inventing dwell", () => {
    const raw = input();
    raw.seating.push({ ...solid("seat2", 12, 25), seats: 4, dwellMin: 25 });
    expect(deriveSimParams(createLayout(raw))).toMatchObject({
      stationCount: 1,
      queueCapacity: 9,
      seatingCapacity: 6,
      dwellMin: 20,
      usableSf: 1500,
      sfPerStation: 100,
    });
    raw.seating = [];
    expect(deriveSimParams(createLayout(raw))).toMatchObject({
      seatingCapacity: 0,
      dwellMin: null,
    });
  });
  it("keeps derived capacity finite when policy numbers are pathologically small", () => {
    const layout = createLayout(input());
    expect(
      errors(() =>
        parseLayout({
          ...layout,
          policy: {
            ...layout.policy,
            queueSpacingFt: { value: Number.MIN_VALUE, ...source },
          },
        }),
      ),
    ).toHaveProperty(["layout.policy.queueSpacingFt.value"]);
  });
  it("supports seating, counter, entrance, back-of-house, room and policy setters", () => {
    let layout = createLayout(input());
    const ops: LayoutOp[] = [
      {
        op: "add_seating",
        seating: { ...solid("seat2", 12, 25), seats: 4, dwellMin: 20 },
      },
      { op: "set_counter", counter: solid("counter", 31, 8, 4, 4) },
      {
        op: "set_entrance",
        entrance: { ...layout.entrance, point: { x: 0, y: 12 } },
      },
      { op: "set_back_of_house", backOfHouse: solid("boh", 31, 30, 9, 10) },
      {
        op: "set_room",
        room: deriveRoomBounds({
          matterport: { widthFt: 42, depthFt: 42, evidenceIds: ["scan"] },
        }),
      },
      {
        op: "set_policy",
        policy: { ...layout.policy, queueSpacingFt: { value: 3, ...source } },
      },
    ];
    for (const [i, op] of ops.entries())
      layout = applyLayoutOp(layout, op, { layoutId: `v${i}` });
    expect(deriveSimParams(layout)).toMatchObject({
      queueCapacity: 6,
      seatingCapacity: 6,
    });
  });
});

it("shortening the queue reduces capacity and increases fixture balks", () => {
  const long = createLayout(input());
  const short = applyLayoutOp(
    long,
    {
      op: "set_queue_path",
      queuePath: {
        ...long.queuePath,
        points: [
          { x: 24, y: 10 },
          { x: 26, y: 10 },
        ],
      },
    },
    { layoutId: "short" },
  );
  expect(deriveSimParams(short).queueCapacity).toBe(1);
  const schedule = {
    siteId: "site-1",
    seed: 1,
    dayType: "weekday",
    openMin: 480,
    closeMin: 540,
    demandSource: "huff",
    params: {},
    stayCurves: [{ personaId: "p", points: [{ lineLength: 0, p: 1 }] }],
    customers: Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      personaId: "p",
      arrivalMin: 480 + i,
      stayDraw: 0,
      serviceMin: 30,
    })),
  };
  const config = {
    hours: {
      weekday: { openMin: 480, closeMin: 540 },
      weekend: { openMin: 480, closeMin: 540 },
    },
    stations: { planned: 1, usableSf: 1500, sfPerStation: 100 },
    service: { meanServiceMin: 30 },
    prices: { avgTicketUsd: 10 },
    staff: { headcount: 1, wageUsdPerHour: 20 },
    costs: { cogsPctOfRevenue: 0.3 },
    lease: {
      sf: 1600,
      askingRentUsdPerSfYear: 24,
      tripleNet: false,
      buildoutUsd: 0,
      leaseTermMonths: 12,
    },
    calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
  };
  const run = (layout: Layout) =>
    simulateDay(schedule, {
      ...config,
      queueCapacity: deriveSimParams(layout).queueCapacity,
    });
  expect(run(long).metrics.balked).toBe(0);
  expect(run(short).metrics.balked).toBe(8);
});

it("adapts layout changes to the existing scenario diff hook and inversion", () => {
  const a = createLayout(input());
  const b = applyLayoutOp(
    a,
    { op: "move", elementId: "s1", position: { x: 24, y: 20 }, ...source },
    { layoutId: "l2" },
  );
  const layouts = new Map([
    [a.layoutId, a],
    [b.layoutId, b],
  ]);
  const hook = createLayoutDiffHook((id) => layouts.get(id) ?? null);
  const root = createRootScenario({
    id: "scenario1",
    projectId: "project",
    siteIds: ["site-1"],
    profileVersion: 1,
    layoutId: "l1",
    label: "A",
    author: "founder",
    createdAt: "2026-11-14T00:00:00Z",
  });
  const next = { ...root, id: "scenario2", layoutId: "l2" };
  const diff = diffScenarios(root, next, hook);
  expect(diff.layout?.summary).toMatchObject({ changedElementIds: ["s1"] });
  expect(invertScenarioDiff(diff, hook)).toEqual(
    diffScenarios(next, root, hook),
  );
  expect(hook.summarize(null, "l1")).not.toBeNull();
  expect(errors(() => hook.summarize("missing", "l1"))).toHaveProperty([
    "layoutId",
  ]);
});
