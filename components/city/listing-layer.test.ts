import { afterEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "cesium";
import { createListingLayer, type ListingLayerOptions } from "./listing-layer";
import { groupListingMarkers } from "./listing-markers";

afterEach(() => vi.unstubAllGlobals());
function fixture(reduced = false) {
  const listeners = new Map<string, () => void>();
  const canvas = {
    clientWidth: 1366,
    clientHeight: 800,
    addEventListener: vi.fn((type, callback) => listeners.set(type, callback)),
    removeEventListener: vi.fn(),
    closest: () => null,
  };
  const camera = {
    cancelFlight: vi.fn(),
    setView: vi.fn(),
    flyTo: vi.fn(),
    frustum: { fovy: Math.PI / 3 },
  };
  const entities = { add: vi.fn((entity) => entity), remove: vi.fn() };
  const stopPostRender = vi.fn();
  const scene = {
    canvas,
    pick: vi.fn(),
    requestRender: vi.fn(),
    postRender: { addEventListener: vi.fn(() => stopPostRender) },
  };
  const viewer = { camera, entities, scene } as unknown as Viewer;
  const input = {
    callback: undefined as undefined | ((event: { position: unknown }) => void),
    destroy: vi.fn(),
  };
  const disconnect = vi.fn();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  class Value {
    constructor(public value: unknown) {}
  }
  const sdk = {
    ScreenSpaceEventHandler: class {
      setInputAction(callback: typeof input.callback) {
        input.callback = callback;
      }
      destroy = input.destroy;
    },
    ScreenSpaceEventType: { LEFT_CLICK: 1 },
    Cartesian3: { fromDegrees: (...value: number[]) => value },
    Cartesian2: class {
      constructor(
        public x: number,
        public y: number,
      ) {}
    },
    Color: { WHITE: "white", fromCssColorString: (v: string) => v },
    HeightReference: { RELATIVE_TO_GROUND: 3 },
    ConstantProperty: Value,
  } as unknown as typeof import("cesium");
  const options: ListingLayerOptions = {
    markers: groupListingMarkers([
      {
        siteId: "a",
        propertyId: "p",
        longitude: -95.6,
        latitude: 29.7,
        address: "Fixture",
      },
      {
        siteId: "b",
        propertyId: "p",
        longitude: -95.6,
        latitude: 29.7,
        address: "Fixture",
      },
    ]),
    selectedSiteId: "b",
    onSelectSite: vi.fn(),
    cameraRequest: { kind: "overview", revision: 0 },
  };
  return {
    viewer,
    sdk,
    camera,
    scene,
    entities,
    options,
    input,
    listeners,
    canvas,
    disconnect,
    stopPostRender,
  };
}
describe("existing Cesium viewer shortlist attachment", () => {
  it("keeps selected unit on grouped picking, changes camera without rebuilding entities and disposes everything", () => {
    const f = fixture();
    const layer = createListingLayer(f.viewer, f.sdk, f.options);
    expect(f.entities.add).toHaveBeenCalledTimes(1);
    expect(f.camera.setView).toHaveBeenCalledWith(
      expect.objectContaining({
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      }),
    );
    f.scene.pick.mockReturnValue({ id: f.entities.add.mock.results[0].value });
    f.input.callback!({ position: {} });
    expect(f.options.onSelectSite).toHaveBeenCalledWith("b");
    layer.update({
      ...f.options,
      selectedSiteId: "a",
      cameraRequest: { kind: "selection", revision: 1 },
    });
    expect(f.entities.add).toHaveBeenCalledTimes(1);
    expect(f.camera.flyTo).toHaveBeenCalledTimes(1);
    const flights = f.camera.flyTo.mock.calls.length;
    layer.update({
      ...f.options,
      selectedSiteId: "a",
      cameraRequest: { kind: "selection", revision: 1 },
    });
    expect(f.camera.flyTo).toHaveBeenCalledTimes(flights);
    const cancels = f.camera.cancelFlight.mock.calls.length;
    f.listeners.get("pointerdown")!();
    expect(f.camera.cancelFlight).toHaveBeenCalledTimes(cancels + 1);
    layer.destroy();
    layer.destroy();
    expect(f.input.destroy).toHaveBeenCalledTimes(1);
    expect(f.entities.remove).toHaveBeenCalledTimes(1);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(f.stopPostRender).toHaveBeenCalledTimes(1);
    expect(f.canvas.removeEventListener).toHaveBeenCalledTimes(3);
  });
  it("uses instant overhead framing with reduced motion and removes obsolete shortlist entities", () => {
    const f = fixture(true);
    const layer = createListingLayer(f.viewer, f.sdk, f.options);
    layer.update({
      ...f.options,
      cameraRequest: { kind: "selection", revision: 1 },
    });
    expect(f.camera.flyTo).not.toHaveBeenCalled();
    expect(f.camera.setView).toHaveBeenCalledTimes(2);
    layer.update({ ...f.options, markers: [] });
    expect(f.entities.remove).toHaveBeenCalledTimes(1);
    layer.destroy();
  });
});
