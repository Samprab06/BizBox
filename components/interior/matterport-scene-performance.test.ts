import { fixtureRenderPalette } from "../simulator/render-palette.fixture";
import { expect, it, vi } from "vitest";
import * as Three from "three";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";

// A crowded layout well beyond the demo's peak, so the budget covers 100+ dots.
const crowd = { size: 160, tick: 0 };
vi.mock("./scan-layout", () => ({
  scanLayout: (_frame: unknown, stationCount: number) => {
    const t = crowd.tick;
    return {
      people: Array.from({ length: crowd.size }, (_, index) => ({
        // Ids churn slowly so dots also enter and leave between frames.
        id: `customer-${index + Math.floor(t / 40) * 7}`,
        role: index % 12 === 0 ? "employee" : "customer",
        state: "queue",
        x: Math.sin(index + t / 20) * 6,
        z: Math.cos(index * 1.3 + t / 25) * 4,
      })),
      stations: Array.from({ length: stationCount }, (_, index) => ({
        x: index * 2.2,
        z: 0,
      })),
    };
  },
}));

const { attachReplayScene } = await import("./matterport-scene");
type Component = import("./matterport-scene").ReplayComponent;

const placement = {
  origin: { x: 17.1, y: 0.04, z: 10.3 },
  rotationY: Math.PI,
  scale: 0.5,
};
const { run } = makeDemo()[1];
const frame = interiorFrame(run, 504, 2);

function mockSdk() {
  let factory: () => Component = () => {
    throw new Error("unregistered");
  };
  let component: Component | undefined;
  const unregister = vi.fn();
  const stop = vi.fn(() => component?.onDestroy());
  const sdk = {
    Scene: {
      register: async (_name: string, fn: () => Component) => {
        factory = fn;
        return { dispose: unregister };
      },
      createObjects: async () => [
        {
          addNode: () => ({
            addComponent: (_name: string, inputs: Component["inputs"]) => {
              component = factory();
              Object.assign(component.outputs, {
                objectRoot: null,
                collider: null,
              });
              component.context = { three: Three };
              Object.assign(component.inputs, inputs);
              return component;
            },
          }),
          start: () => component!.onInit(),
          stop,
        },
      ],
    },
  };
  return {
    sdk,
    stop,
    unregister,
    get component() {
      return component!;
    },
  };
}

it(`keeps per-frame overlay updates within budget with ${crowd.size} dots`, async () => {
  const fake = mockSdk();
  const replay = { frame, selected: "customer-3", stationCount: 2 };
  const session = await attachReplayScene(
    fake.sdk,
    placement,
    replay,
    () => {},
  );
  const root = fake.component.outputs.objectRoot!;
  const geometry = vi.spyOn(Three.BufferGeometry.prototype, "dispose");
  const frameTimes: number[] = [];
  for (let tick = 0; tick < 400; tick++) {
    crowd.tick = tick;
    const started = performance.now();
    fake.component.onInputsUpdated();
    frameTimes.push(performance.now() - started);
  }
  frameTimes.sort((a, b) => a - b);
  const median = frameTimes[Math.floor(frameTimes.length / 2)];
  const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
  // A 60 fps frame is 16.7 ms; the overlay may use a small slice of it.
  expect(median).toBeLessThan(2);
  expect(p95).toBeLessThan(6);
  // Dots and counters are reused: no growth as ids churn.
  expect(root.children).toHaveLength(crowd.size + 2);
  // Every dot shares the component's four geometries and five materials.
  const geometries = new Set<unknown>();
  const materials = new Set<unknown>();
  root.traverse((object) => {
    if (object instanceof Three.Mesh) {
      geometries.add(object.geometry);
      materials.add(object.material);
    }
  });
  expect(geometries.size).toBeLessThanOrEqual(4);
  expect(materials.size).toBeLessThanOrEqual(5);
  expect(geometry).not.toHaveBeenCalled();

  session.dispose();
  session.dispose();
  expect(fake.stop).toHaveBeenCalledOnce();
  expect(fake.unregister).toHaveBeenCalledOnce();
  expect(geometry).toHaveBeenCalledTimes(4);
  expect(fake.component.outputs.objectRoot).toBeNull();
  geometry.mockRestore();
});

it("releases the registration when an abort lands while objects are created", async () => {
  const fake = mockSdk();
  const controller = new AbortController();
  const createObjects = fake.sdk.Scene.createObjects;
  fake.sdk.Scene.createObjects = async () => {
    controller.abort();
    return createObjects();
  };
  await expect(
    attachReplayScene(
      fake.sdk,
      placement,
      { frame, selected: "", stationCount: 1 },
      () => {},
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
  expect(fake.stop).toHaveBeenCalledOnce();
  expect(fake.unregister).toHaveBeenCalledOnce();
});

it("does not register anything once already aborted", async () => {
  const fake = mockSdk();
  const register = vi.spyOn(fake.sdk.Scene, "register");
  await expect(
    attachReplayScene(
      fake.sdk,
      placement,
      { frame, selected: "", stationCount: 1 },
      () => {},
      AbortSignal.abort(),
    ),
  ).rejects.toThrow("cancelled");
  expect(register).not.toHaveBeenCalled();
});

vi.mock("../simulator/render-palette", async (original) => ({
  ...(await original<typeof import("../simulator/render-palette")>()),
  readRenderPalette: () => fixtureRenderPalette(),
}));
