import { expect, it, vi } from "vitest";
import {
  type NativePose,
  type NativeSweep,
  type NativeHit,
  watchNativeFloorContext,
} from "./native-floor-context";
function fixture(throttleMs = 0) {
  let pose!: (value: NativePose) => void,
    pointer!: (value: NativeHit) => void,
    current!: (value: NativeSweep) => void,
    data!: (value: Record<string, NativeSweep>) => void;
  const cancel = vi.fn();
  const sdk = {
    Camera: {
      pose: {
        subscribe: (fn: (value: NativePose) => void) => {
          pose = fn;
          return { cancel };
        },
      },
    },
    Pointer: {
      intersection: {
        subscribe: (fn: (value: NativeHit) => void) => {
          pointer = fn;
          return { cancel };
        },
      },
    },
    Sweep: {
      current: {
        subscribe: (fn: (value: NativeSweep) => void) => {
          current = fn;
          return { cancel };
        },
      },
      data: {
        subscribe: (observer: {
          onCollectionUpdated: (value: Record<string, NativeSweep>) => void;
        }) => {
          data = observer.onCollectionUpdated;
          return { cancel };
        },
      },
    },
  };
  const changes: unknown[] = [];
  const dispose = watchNativeFloorContext(
    sdk,
    "Synthetic01",
    (value) => changes.push(value),
    { throttleMs },
  );
  return {
    pose: (v: NativePose) => pose(v),
    pointer: (v: NativeHit) => pointer(v),
    current: (v: NativeSweep) => current(v),
    data: (v: Record<string, NativeSweep>) => data(v),
    changes,
    dispose,
    cancel,
  };
}
const floor = {
  id: "s",
  enabled: true,
  puckPosition: { x: 0, y: 0, z: 0 },
  floorInfo: { id: "f" },
};
it("uses a current-floor pointer and rejects raised tabletop hits", () => {
  const f = fixture();
  f.current(floor);
  f.pose({
    position: { x: 0, y: 1.5, z: 0 },
    rotation: { x: -20, y: 0 },
    sweep: "s",
  });
  f.pointer({
    position: { x: 0, y: 0, z: -2 },
    normal: { x: 0, y: 1, z: 0 },
    object: "intersectedobject.model",
  });
  expect(f.changes.at(-1)).toMatchObject({
    placementAvailable: true,
    floorPointSource: "pointer",
    floorPoint: { x: 0, y: 0, z: -2 },
  });
  f.pointer({ position: { x: 0, y: 1, z: -2 }, normal: { x: 0, y: 1, z: 0 } });
  expect(f.changes.at(-1)).toMatchObject({ placementAvailable: false });
  f.dispose();
  expect(f.cancel).toHaveBeenCalledTimes(4);
});
it("prefers known floor sweeps visible ahead, never a point behind camera or on another floor", () => {
  const f = fixture();
  f.current(floor);
  f.pose({
    position: { x: 0, y: 1.5, z: 0 },
    rotation: { x: 0, y: 0 },
    sweep: "s",
  });
  f.data({
    behind: { ...floor, id: "back", puckPosition: { x: 0, y: 0, z: 2 } },
    ahead: { ...floor, id: "front", puckPosition: { x: 0, y: 0, z: -2 } },
    up: {
      ...floor,
      id: "up",
      floorInfo: { id: "upper" },
      puckPosition: { x: 0, y: 3, z: -1 },
    },
  });
  expect(f.changes.at(-1)).toMatchObject({
    floorPointSource: "sweep",
    floorPoint: { x: 0, y: 0, z: -2 },
  });
  f.pose({
    position: { x: 0, y: 1.5, z: 0 },
    rotation: { x: 0, y: 0 },
    sweep: "",
  });
  expect(f.changes.at(-1)).toMatchObject({ placementAvailable: false });
  f.dispose();
});

it("coalesces rapid native updates and cancels queued publication on teardown", () => {
  vi.useFakeTimers();
  try {
    const f = fixture(100);
    f.current(floor);
    f.pose({
      position: { x: 0, y: 1.5, z: 0 },
      rotation: { x: -20, y: 0 },
      sweep: "s",
    });
    for (let index = 0; index < 20; index++)
      f.pointer({
        position: { x: index / 10, y: 0, z: -2 },
        normal: { x: 0, y: 1, z: 0 },
      });
    expect(f.changes).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(f.changes).toHaveLength(1);
    expect(f.changes[0]).toMatchObject({ floorPoint: { x: 1.9, y: 0, z: -2 } });
    f.pointer({
      position: { x: 2, y: 0, z: -2 },
      normal: { x: 0, y: 1, z: 0 },
    });
    f.dispose();
    vi.advanceTimersByTime(100);
    expect(f.changes).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
