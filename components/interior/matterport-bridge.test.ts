import { afterEach, expect, it, vi } from "vitest";
import {
  waitForPlaying,
  connectShowcase,
  focusServiceArea,
  viewerFailure,
  ViewerError,
  type ShowcaseWindow,
  type MatterportSdk,
} from "./matterport-bridge";

afterEach(() => vi.useRealTimers());
function observable(synchronous = false) {
  const cancel = vi.fn();
  let listener: (state: { phase: string }) => void = () => {};
  const subscribe = vi.fn((callback: typeof listener) => {
    listener = callback;
    if (synchronous) callback({ phase: "playing" });
    return { cancel };
  });
  const sdk = {
    App: { Phase: { PLAYING: "playing" }, state: { subscribe } },
  } as unknown as MatterportSdk;
  return {
    sdk,
    cancel,
    subscribe,
    emit: (phase: string) => listener({ phase }),
  };
}

it("waits for PLAYING and cancels its state subscription", async () => {
  const fixture = observable();
  const result = waitForPlaying(fixture.sdk, new AbortController().signal);
  fixture.emit("loading");
  expect(fixture.cancel).not.toHaveBeenCalled();
  fixture.emit("playing");
  await expect(result).resolves.toBeUndefined();
  expect(fixture.cancel).toHaveBeenCalledOnce();
});

it("cleans up subscriptions even when current PLAYING state arrives synchronously", async () => {
  const fixture = observable(true);
  await waitForPlaying(fixture.sdk, new AbortController().signal);
  expect(fixture.cancel).toHaveBeenCalledOnce();
});

it("aborts and clears timeout/subscription when the viewer unmounts", async () => {
  vi.useFakeTimers();
  const fixture = observable();
  const controller = new AbortController();
  const result = waitForPlaying(fixture.sdk, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(fixture.cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a viewer that never reaches PLAYING and leaves no subscription", async () => {
  vi.useFakeTimers();
  const fixture = observable();
  const result = waitForPlaying(fixture.sdk, new AbortController().signal, 100);
  const rejection = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await rejection;
  expect(fixture.cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds MP_SDK.connect itself and consumes a late rejection without leaking its timer", async () => {
  vi.useFakeTimers();
  let rejectConnect: (reason: Error) => void = () => {};
  const target = {
    MP_SDK: {
      connect: () =>
        new Promise<MatterportSdk>((_resolve, reject) => {
          rejectConnect = reject;
        }),
    },
  } as unknown as ShowcaseWindow;
  const result = connectShowcase(target, new AbortController().signal, 100);
  const rejected = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  rejectConnect(new Error("must never surface raw provider details"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels an unresolved connect when its iframe unmounts", async () => {
  const target = {
    MP_SDK: { connect: () => new Promise<MatterportSdk>(() => {}) },
  } as unknown as ShowcaseWindow;
  const controller = new AbortController();
  const result = connectShowcase(target, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
});

it("moves to the calibrated service sweep with an instant transition", async () => {
  const moveTo = vi.fn(async () => {});
  const sdk = {
    Sweep: { moveTo, Transition: { INSTANT: "instant" } },
  } as unknown as MatterportSdk;
  const viewpoint = { sweepId: "service-area", rotation: { x: -17, y: 168 } };
  await focusServiceArea(sdk, viewpoint);
  expect(moveTo).toHaveBeenCalledWith("service-area", {
    rotation: viewpoint.rotation,
    transition: "instant",
  });
});

it("detects an unavailable model in the iframe and disconnects its observer", async () => {
  const disconnect = vi.fn();
  class Observer {
    observe() {}
    disconnect = disconnect;
  }
  const connect = vi.fn(() => new Promise<MatterportSdk>(() => {}));
  const target = {
    MP_SDK: { connect },
    MutationObserver: Observer,
    document: { body: { textContent: "Oops! Model not available" } },
  } as unknown as ShowcaseWindow;
  await expect(
    connectShowcase(target, new AbortController().signal),
  ).rejects.toThrow("model unavailable");
  expect(connect).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("sanitizes provider failures instead of forwarding SDK URLs or key details", async () => {
  const target = {
    MP_SDK: {
      connect: async () => {
        throw new Error("provider error with applicationKey=example-secret");
      },
    },
  } as unknown as ShowcaseWindow;
  await expect(
    connectShowcase(target, new AbortController().signal),
  ).rejects.toThrow(/^Viewer connection unavailable$/);
});

it("disconnects an SDK connection that resolves after the timeout", async () => {
  vi.useFakeTimers();
  let resolve: (sdk: MatterportSdk) => void = () => {};
  const disconnect = vi.fn();
  const target = {
    MP_SDK: {
      connect: () => new Promise<MatterportSdk>((done) => (resolve = done)),
    },
  } as unknown as ShowcaseWindow;
  const result = connectShowcase(target, new AbortController().signal, 1000);
  const settled = expect(result).rejects.toMatchObject({ reason: "timeout" });
  await vi.advanceTimersByTimeAsync(1000);
  await settled;
  resolve({ disconnect } as unknown as MatterportSdk);
  await vi.advanceTimersByTimeAsync(0);
  expect(disconnect).toHaveBeenCalledOnce();
});

it("classifies key and domain refusals separately from other failures", () => {
  expect(viewerFailure(new Error("Invalid application key"))).toBe("key");
  expect(viewerFailure(new Error("403 Forbidden"))).toBe("key");
  expect(viewerFailure(new Error("origin not allowed"))).toBe("key");
  expect(viewerFailure(new Error("WebGL unavailable"))).toBe("unavailable");
  expect(viewerFailure(new ViewerError("model", "gone"))).toBe("model");
  expect(viewerFailure("weird")).toBe("unavailable");
});
