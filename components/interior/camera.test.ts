import { describe, expect, it, vi } from "vitest";
import {
  CameraController,
  connectMatterportCamera,
  INSIDE_FOLLOW_THROTTLE_MS,
  nearestSweep,
  planCamera,
  scanTargets,
  toScanWorld,
  type CameraContext,
  type CameraPort,
  type CameraSdk,
  type SweepNode,
} from "./camera";
import { interiorFrame } from "../simulator/interior-state";
import { makeDemo } from "../simulator/fixture";

const v = (x: number, z: number, y = 0) => ({ x, y, z });
// a - b - c in a line; d is disabled; e is an island with no edges to a.
const sweeps: SweepNode[] = [
  { id: "a", position: v(0, 0), neighbors: ["b"], enabled: true },
  { id: "b", position: v(4, 0), neighbors: ["a", "c"], enabled: true },
  { id: "c", position: v(8, 0), neighbors: ["b"], enabled: true },
  { id: "d", position: v(9, 0), neighbors: ["c"], enabled: false },
  { id: "e", position: v(10, 0), neighbors: [], enabled: true },
];
const context = (overrides: Partial<CameraContext> = {}): CameraContext => ({
  mode: "inside",
  reducedMotion: false,
  sweeps,
  currentSweep: "a",
  stations: [v(3.5, 1, 1), v(7.6, 1, 1)],
  agents: new Map([["customer-1", v(7.5, 0)]]),
  now: 10_000,
  lastFollowAt: null,
  ...overrides,
});

describe("planCamera", () => {
  it("jumps to a known scan point, instant under reduced motion", () => {
    const command = {
      type: "gotoSweep",
      sweepId: "b",
      rotation: { x: 0, y: 90 },
    } as const;
    expect(planCamera(command, context())).toEqual([
      {
        kind: "sweep",
        sweepId: "b",
        rotation: { x: 0, y: 90 },
        transition: "fly",
      },
    ]);
    expect(planCamera(command, context({ reducedMotion: true }))).toEqual([
      {
        kind: "sweep",
        sweepId: "b",
        rotation: { x: 0, y: 90 },
        transition: "instant",
      },
    ]);
    expect(
      planCamera({ type: "gotoSweep", sweepId: "d" }, context()),
    ).toBeNull();
    expect(
      planCamera({ type: "gotoSweep", sweepId: "zz" }, context()),
    ).toBeNull();
  });

  it("looks at a station with moveToClosestSweep, or jumps first under reduced motion", () => {
    expect(
      planCamera({ type: "lookAtStation", station: 1 }, context()),
    ).toEqual([
      { kind: "lookAt", position: v(7.6, 1, 1), moveToClosestSweep: true },
    ]);
    expect(
      planCamera(
        { type: "lookAtStation", station: 1 },
        context({ reducedMotion: true }),
      ),
    ).toEqual([
      { kind: "sweep", sweepId: "c", transition: "instant" },
      { kind: "lookAt", position: v(7.6, 1, 1), moveToClosestSweep: false },
    ]);
    expect(
      planCamera({ type: "lookAtStation", station: 4 }, context()),
    ).toBeNull();
  });

  it("switches mode only when it changes", () => {
    expect(
      planCamera({ type: "setMode", mode: "dollhouse" }, context()),
    ).toEqual([{ kind: "mode", mode: "dollhouse", transition: "fly" }]);
    expect(
      planCamera(
        { type: "setMode", mode: "floorplan" },
        context({ reducedMotion: true }),
      ),
    ).toEqual([{ kind: "mode", mode: "floorplan", transition: "instant" }]);
    expect(planCamera({ type: "setMode", mode: "inside" }, context())).toEqual(
      [],
    );
  });

  it("follows inside by hopping to the nearest reachable scan point, throttled", () => {
    const follow = { type: "follow", agentId: "customer-1" } as const;
    // e (10,0) is not connected to a, d is disabled: c is the reachable nearest.
    expect(planCamera(follow, context())).toEqual([
      { kind: "sweep", sweepId: "c", transition: "fly" },
      { kind: "lookAt", position: v(7.5, 0), moveToClosestSweep: false },
    ]);
    expect(
      planCamera(
        follow,
        context({ lastFollowAt: 10_000 - INSIDE_FOLLOW_THROTTLE_MS + 1 }),
      ),
    ).toEqual([]);
    // Still visible to the sensor after a hop: stay put.
    expect(
      planCamera(
        follow,
        context({ lastFollowAt: 0, targetVisible: true, currentSweep: "c" }),
      ),
    ).toEqual([]);
    // Already at the nearest point: only re-aim.
    expect(planCamera(follow, context({ currentSweep: "c" }))).toEqual([
      { kind: "lookAt", position: v(7.5, 0), moveToClosestSweep: false },
    ]);
    expect(
      planCamera({ type: "follow", agentId: "nobody" }, context()),
    ).toBeNull();
  });

  it("follows smoothly in dollhouse and instantly under reduced motion", () => {
    const follow = { type: "follow", agentId: "customer-1" } as const;
    expect(planCamera(follow, context({ mode: "dollhouse" }))).toEqual([
      { kind: "pan", position: v(7.5, 0), transition: "fly" },
    ]);
    expect(
      planCamera(follow, context({ mode: "dollhouse", reducedMotion: true })),
    ).toEqual([{ kind: "pan", position: v(7.5, 0), transition: "instant" }]);
    expect(
      planCamera(follow, context({ mode: "dollhouse", lastFollowAt: 9_900 })),
    ).toEqual([]);
  });

  it("seeks the shared clock within the day", () => {
    expect(planCamera({ type: "seek", minute: 615 }, context())).toEqual([
      { kind: "seek", minute: 615 },
    ]);
    expect(planCamera({ type: "seek", minute: 5000 }, context())).toEqual([
      { kind: "seek", minute: 1440 },
    ]);
    expect(planCamera({ type: "seek", minute: NaN }, context())).toBeNull();
  });

  it("nearestSweep searches every enabled sweep when the current one is unknown", () => {
    expect(nearestSweep(v(9.6, 0), sweeps, null)?.id).toBe("e");
    expect(nearestSweep(v(9.6, 0), sweeps, "a")?.id).toBe("c");
  });
});

describe("scan coordinates", () => {
  it("matches the replay root transform", () => {
    const placement = {
      origin: { x: 1, y: 2, z: 3 },
      rotationY: Math.PI / 2,
      scale: 2,
    };
    const point = toScanWorld(placement, { x: 1, z: 0 });
    expect(point.x).toBeCloseTo(1);
    expect(point.y).toBeCloseTo(2.4);
    expect(point.z).toBeCloseTo(2);
  });

  it("locates people and counters from the replay frame", () => {
    const [{ run, staffing }] = makeDemo();
    const minute = run.events[Math.floor(run.events.length / 2)].timeMin;
    const targets = scanTargets(
      {
        frame: interiorFrame(run, minute, staffing?.headcount),
        stationCount: run.metrics.stations,
        selected: "",
      },
      { origin: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 },
    );
    expect(targets.stations).toHaveLength(run.metrics.stations);
    expect(targets.agents.size).toBeGreaterThan(0);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function mockPort() {
  const calls: string[] = [];
  const pending: Array<ReturnType<typeof deferred>> = [];
  const locks: boolean[] = [];
  const move = (label: string) => {
    calls.push(label);
    const next = deferred();
    pending.push(next);
    return next.promise;
  };
  const port: CameraPort = {
    snapshot: () => ({ mode: "inside", sweeps, currentSweep: "a" }),
    gotoSweep: (id, _rotation, transition) => move(`sweep:${id}:${transition}`),
    lookAt: (_p, closest) => move(`lookAt:${closest}`),
    setMode: (mode, transition) => move(`mode:${mode}:${transition}`),
    pan: (_p, transition) => move(`pan:${transition}`),
    seek: vi.fn((minute: number) => {
      calls.push(`seek:${minute}`);
    }),
    setNavigationLocked: (locked) => locks.push(locked),
  };
  return {
    port,
    calls,
    locks,
    settle: async () => {
      await new Promise((r) => setTimeout(r, 0));
      pending.shift()?.resolve();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("CameraController", () => {
  const targets = () => ({
    stations: [v(3.5, 1)],
    agents: new Map([["customer-1", v(7.5, 0)]]),
  });

  it("runs one transition at a time, in order, and locks navigation while driving", async () => {
    const mock = mockPort();
    const camera = new CameraController(mock.port, { targets });
    const first = camera.run({ type: "gotoSweep", sweepId: "b" });
    const second = camera.run({ type: "setMode", mode: "dollhouse" });
    const third = camera.run({ type: "seek", minute: 600 });
    await flush();
    expect(mock.calls).toEqual(["sweep:b:fly"]);
    expect(mock.locks).toEqual([true]);
    await mock.settle();
    expect(mock.calls).toEqual(["sweep:b:fly", "mode:dollhouse:fly"]);
    await mock.settle();
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(mock.calls.at(-1)).toBe("seek:600");
    expect(mock.locks).toEqual([true, false]);
    expect(camera.status.driving).toBe(false);
  });

  it("founder input cancels the pending move and unlocks at once", async () => {
    const mock = mockPort();
    const camera = new CameraController(mock.port, { targets });
    const moving = camera.run({ type: "gotoSweep", sweepId: "c" });
    const queued = camera.run({ type: "lookAtStation", station: 0 });
    await flush();
    camera.founderInput();
    await expect(moving).resolves.toBe("cancelled");
    await expect(queued).resolves.toBe("cancelled");
    expect(mock.locks).toEqual([true, false]);
    // The cancelled SDK transition must finish before the agent's next one starts.
    const next = camera.run({ type: "setMode", mode: "floorplan" });
    await flush();
    expect(mock.calls).toEqual(["sweep:c:fly"]);
    await mock.settle();
    expect(mock.calls).toEqual(["sweep:c:fly", "mode:floorplan:fly"]);
    await mock.settle();
    await expect(next).resolves.toBe("done");
  });

  it("uses instant transitions under reduced motion", async () => {
    const mock = mockPort();
    const camera = new CameraController(mock.port, {
      targets,
      reducedMotion: () => true,
    });
    const done = camera.run({ type: "gotoSweep", sweepId: "b" });
    await mock.settle();
    await expect(done).resolves.toBe("done");
    expect(mock.calls).toEqual(["sweep:b:instant"]);
  });

  it("keeps following through ticks until the founder takes over", async () => {
    const mock = mockPort();
    let now = 0;
    const camera = new CameraController(mock.port, { targets, now: () => now });
    const started = camera.run({ type: "follow", agentId: "customer-1" });
    await mock.settle();
    await mock.settle();
    await expect(started).resolves.toBe("done");
    expect(camera.status.following).toBe("customer-1");
    expect(mock.locks).toEqual([true]);
    now = 100;
    camera.tick();
    await flush();
    expect(mock.calls).toHaveLength(2); // throttled
    camera.founderInput();
    expect(camera.status.following).toBeNull();
    expect(mock.locks).toEqual([true, false]);
  });

  it("reports commands that cannot run as failed", async () => {
    const mock = mockPort();
    const camera = new CameraController(mock.port, { targets });
    await expect(
      camera.run({ type: "lookAtStation", station: 9 }),
    ).resolves.toBe("failed");
  });
});

describe("connectMatterportCamera", () => {
  it("maps ports onto the SDK and locks mp.input", async () => {
    const moveTo = vi.fn(async () => undefined);
    const lookAt = vi.fn(async () => undefined);
    const modeMoveTo = vi.fn(async () => undefined);
    const inputs: Record<string, unknown> = {};
    let drag = () => {};
    const sdk: CameraSdk = {
      Sweep: {
        moveTo,
        Transition: { INSTANT: "t.instant", FLY: "t.fly" },
        current: { subscribe: (cb) => (cb({ sid: "s1" }), { cancel() {} }) },
      },
      Camera: { lookAt },
      Mode: {
        moveTo: modeMoveTo,
        Mode: { INSIDE: "mi", DOLLHOUSE: "md", FLOORPLAN: "mf" },
        TransitionType: { INSTANT: "ti", FLY: "tf" },
        current: { subscribe: (cb) => (cb("md"), { cancel() {} }) },
      },
      Scene: {
        createObjects: async () => [
          {
            addNode: () => ({
              addComponent: (_name: string, initial: unknown) => {
                Object.assign(inputs, initial);
                return {
                  inputs,
                  spyOnEvent: ({ eventType, onEvent }) => {
                    if (eventType === "INPUT.DRAG") drag = onEvent;
                    return { cancel() {} };
                  },
                };
              },
            }),
            start: () => undefined,
            stop: () => undefined,
          },
        ],
      },
    };
    const seek = vi.fn();
    const onFounderInput = vi.fn();
    const { port, dispose } = connectMatterportCamera(sdk, {
      seek,
      onFounderInput,
    });
    await flush();
    expect(port.snapshot()).toMatchObject({
      mode: "dollhouse",
      currentSweep: "s1",
    });
    await port.gotoSweep("s2", undefined, "instant");
    expect(moveTo).toHaveBeenCalledWith("s2", { transition: "t.instant" });
    await port.setMode("floorplan", "fly");
    expect(modeMoveTo).toHaveBeenCalledWith("mf", { transition: "tf" });
    await port.lookAt(v(1, 2), true);
    expect(lookAt).toHaveBeenCalledWith(v(1, 2), { moveToClosestSweep: true });
    port.seek(700);
    expect(seek).toHaveBeenCalledWith(700);
    port.setNavigationLocked(true);
    expect(inputs.userNavigationEnabled).toBe(false);
    drag();
    expect(onFounderInput).toHaveBeenCalledTimes(1);
    dispose();
    expect(inputs.userNavigationEnabled).toBe(true);
  });

  it("fails a command whose SDK surface is missing", async () => {
    const { port } = connectMatterportCamera(
      {},
      { seek: () => {}, onFounderInput: () => {} },
    );
    await expect(port.lookAt(v(0, 0), true)).rejects.toThrow(
      "Camera.lookAt unavailable",
    );
  });
});
