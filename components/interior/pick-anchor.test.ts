import { describe, expect, test, vi } from "vitest";
import { ScanPlacementSchema } from "@/lib/contracts/interior";
import { roomToScan } from "@/lib/layout/scan-transform";
import {
  DEFAULT_ROOM_ANCHORS,
  createAnchorPicker,
  initialPickerState,
  pickAnchorEnabled,
  type PointerIntersection,
} from "./pick-anchor";

function mockSdk() {
  let listener: ((hit: PointerIntersection) => void) | undefined;
  const cancel = vi.fn();
  return {
    sdk: {
      Pointer: {
        intersection: {
          subscribe(callback: (hit: PointerIntersection) => void) {
            listener = callback;
            return { cancel };
          },
        },
      },
    },
    hover(position: PointerIntersection["position"], normalY = 1) {
      listener?.({ position, normal: { x: 0, y: normalY, z: 0 } });
    },
    cancel,
  };
}
const truth = {
  origin: { x: 17.1, y: 0.04, z: 10.3 },
  rotationY: Math.PI,
  floorY: 0.04,
};

describe("pick anchor", () => {
  test("is development-only", () => {
    expect(pickAnchorEnabled("production")).toBe(false);
    expect(pickAnchorEnabled("development")).toBe(true);
    expect(pickAnchorEnabled("test")).toBe(true);
  });

  test("records floor intersections and solves the placement", () => {
    const mock = mockSdk();
    const onChange = vi.fn();
    const picker = createAnchorPicker(mock.sdk, { scale: 0.5, onChange });
    expect(picker.state()).toEqual(initialPickerState());
    for (const room of DEFAULT_ROOM_ANCHORS) {
      mock.hover(roomToScan(truth, room));
      picker.record();
    }
    const state = picker.state();
    expect(state.picked).toHaveLength(3);
    expect(state.next).toBeNull();
    expect(state.error).toBeNull();
    expect(state.solved!.placement.origin.x).toBeCloseTo(17.1, 9);
    expect(state.solved!.placement.origin.z).toBeCloseTo(10.3, 9);
    expect(Math.abs(state.solved!.placement.rotationY)).toBeCloseTo(Math.PI, 9);
    const placement = picker.placement({
      entranceSweep: null,
      serviceSweep: { sweepId: "sweep" },
    });
    expect(ScanPlacementSchema.parse(placement)).toMatchObject({
      scale: 0.5,
      serviceSweep: { sweepId: "sweep" },
    });
    expect(state.placement).toMatchObject({ scale: 0.5, serviceSweep: null });
    expect(onChange).toHaveBeenCalled();
    // Extra clicks after the last anchor are ignored.
    picker.record();
    expect(picker.state().picked).toHaveLength(3);
    picker.dispose();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });

  test("two anchors solve; wall hits and missing hovers are rejected", () => {
    const mock = mockSdk();
    const picker = createAnchorPicker(mock.sdk);
    expect(picker.record().error).toMatch(/pointer/);
    mock.hover({ x: 1, y: 1.2, z: 1 }, 0);
    expect(picker.record().error).toMatch(/not on the floor/);
    expect(picker.state().picked).toHaveLength(0);
    mock.hover(roomToScan(truth, DEFAULT_ROOM_ANCHORS[0]));
    picker.record();
    expect(picker.placement()).toBeNull();
    mock.hover(roomToScan(truth, DEFAULT_ROOM_ANCHORS[1]));
    expect(picker.record().solved).not.toBeNull();
    expect(picker.undo().solved).toBeNull();
  });

  test("reports a units mismatch instead of a bad placement", () => {
    const mock = mockSdk();
    const picker = createAnchorPicker(mock.sdk);
    // Picks 10 m apart for anchors 10 ft apart.
    mock.hover({ x: 0, y: 0, z: 0 });
    picker.record();
    mock.hover({ x: 10, y: 0, z: 0 });
    const state = picker.record();
    expect(state.solved).toBeNull();
    expect(state.error).toMatch(/room units/);
  });
});
