import { fixtureRenderPalette } from "../simulator/render-palette.fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Three from "three";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";
import type { MatterportSdk, ShowcaseWindow } from "./matterport-bridge";
import type { ReplayComponent, ScanPlacement } from "./matterport-scene";
import {
  createViewerSession,
  failureStatus,
  publicEmbedUrl,
  type ViewerState,
} from "./matterport-session";

const placement: ScanPlacement = {
  origin: { x: 17.1, y: 0.04, z: 10.3 },
  rotationY: Math.PI,
  scale: 0.5,
};
const viewpoint = { sweepId: "sweep", rotation: { x: 0, y: 0 } };
const { run } = makeDemo()[1];
const replay = {
  frame: interiorFrame(run, 504, 2),
  selected: "",
  stationCount: 2,
};

/** Live abort listeners on the viewer's own, unaborted signals (true leaks). */
const abortListeners = new Set<[EventTarget, unknown]>();
const ours = new WeakSet<AbortSignal>();
const originalAdd = EventTarget.prototype.addEventListener;
const originalRemove = EventTarget.prototype.removeEventListener;
const OriginalController = globalThis.AbortController;
class TrackedController extends OriginalController {
  constructor() {
    super();
    ours.add(this.signal);
  }
}
beforeEach(() => {
  abortListeners.clear();
  globalThis.AbortController = TrackedController;
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: unknown,
    options?: unknown,
  ) {
    if (type === "abort" && ours.has(this as AbortSignal))
      abortListeners.add([this, listener]);
    return originalAdd.call(
      this,
      type,
      listener as EventListener,
      options as AddEventListenerOptions,
    );
  };
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: unknown,
    options?: unknown,
  ) {
    if (type === "abort")
      for (const entry of abortListeners)
        if (entry[0] === this && entry[1] === listener)
          abortListeners.delete(entry);
    return originalRemove.call(
      this,
      type,
      listener as EventListener,
      options as EventListenerOptions,
    );
  };
});
afterEach(() => {
  globalThis.AbortController = OriginalController;
  EventTarget.prototype.addEventListener = originalAdd;
  EventTarget.prototype.removeEventListener = originalRemove;
  vi.useRealTimers();
});
const liveAbortListeners = () =>
  [...abortListeners].filter(([target]) => !(target as AbortSignal).aborted)
    .length;

/** A Bundle SDK double that counts every resource the viewer can leak. */
function fakeShowcase(
  options: {
    connect?: () => Promise<void>;
    startFails?: number;
    bodyText?: string;
  } = {},
) {
  const counts = {
    connections: 0,
    disconnects: 0,
    subscriptions: 0,
    cancels: 0,
    registrations: 0,
    unregisters: 0,
    objects: 0,
    started: 0,
    stopped: 0,
    observers: 0,
    observerDisconnects: 0,
  };
  let startFails = options.startFails ?? 0;
  const listeners = new Set<(state: { phase: string }) => void>();
  const factories = new Map<string, () => ReplayComponent>();
  const components: ReplayComponent[] = [];
  const sdk: MatterportSdk = {
    disconnect: () => {
      counts.disconnects++;
    },
    App: {
      Phase: { PLAYING: "playing" },
      state: {
        subscribe(callback) {
          counts.subscriptions++;
          listeners.add(callback);
          return {
            cancel: () => {
              if (listeners.delete(callback)) counts.cancels++;
            },
          };
        },
      },
    },
    Sweep: {
      moveTo: async () => undefined,
      Transition: { INSTANT: "instant" },
    },
    Scene: {
      register: async (name, factory) => {
        counts.registrations++;
        factories.set(name, factory);
        return {
          dispose: () => {
            if (factories.delete(name)) counts.unregisters++;
          },
        };
      },
      createObjects: async () => {
        counts.objects++;
        let component: ReplayComponent | undefined;
        let state: "new" | "started" | "stopped" = "new";
        return [
          {
            addNode: () => ({
              addComponent: (name: string, inputs) => {
                const created = factories.get(name)!();
                Object.assign(created.outputs, {
                  objectRoot: null,
                  collider: null,
                });
                created.context = { three: Three };
                Object.assign(created.inputs, inputs);
                component = created;
                components.push(created);
                return created;
              },
            }),
            start: async () => {
              // The real SDK cannot start a stopped object again.
              if (state !== "new") throw new Error("Scene object reused");
              state = "started";
              counts.started++;
              if (startFails > 0) {
                startFails--;
                throw new Error("WebGL context lost");
              }
              component?.onInit();
            },
            stop: () => {
              if (state === "stopped") throw new Error("Stopped twice");
              state = "stopped";
              counts.stopped++;
              component?.onDestroy();
            },
          },
        ];
      },
    },
  };
  class Observer {
    constructor(private callback: () => void) {
      counts.observers++;
    }
    observe() {}
    disconnect() {
      counts.observerDisconnects++;
    }
  }
  const body = { textContent: options.bodyText ?? "" };
  const target = {
    document: { body },
    MutationObserver: Observer,
    MP_SDK: {
      connect: async () => {
        await options.connect?.();
        counts.connections++;
        return sdk;
      },
    },
  } as unknown as ShowcaseWindow;
  return {
    target,
    sdk,
    counts,
    components,
    playing() {
      for (const listener of [...listeners]) listener({ phase: "playing" });
    },
    /** Every acquired resource has been released. */
    leaks() {
      return {
        connections: counts.connections - counts.disconnects,
        subscriptions: counts.subscriptions - counts.cancels,
        registrations: counts.registrations - counts.unregisters,
        sceneObjects: counts.started - counts.stopped,
        observers: counts.observers - counts.observerDisconnects,
        abortListeners: liveAbortListeners(),
        timers: vi.getTimerCount(),
      };
    },
  };
}
const noLeaks = {
  connections: 0,
  subscriptions: 0,
  registrations: 0,
  sceneObjects: 0,
  observers: 0,
  abortListeners: 0,
  timers: 0,
};
const settle = () => vi.advanceTimersByTimeAsync(0);

function mount(target: ShowcaseWindow) {
  const states: ViewerState[] = [];
  const session = createViewerSession({
    config: () => ({ placement, viewpoint }),
    replay: () => replay,
    select: () => {},
    onChange: (state) => states.push(state),
  });
  void session.connect(target);
  return { session, states, last: () => states.at(-1)! };
}

describe("viewer session lifecycle", () => {
  it("leaks no listeners, timers, connections or scene objects across 10 mount/unmount cycles", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase();
    for (let cycle = 0; cycle < 10; cycle++) {
      const { session, last } = mount(fake.target);
      await settle();
      // Unmount at every stage: connecting, awaiting PLAYING, and with dots running.
      const stage = cycle % 3;
      if (stage >= 1) {
        expect(fake.leaks().subscriptions).toBe(1);
        fake.playing();
        await settle();
      }
      if (stage === 2) {
        expect(last()).toMatchObject({
          connection: "connected",
          overlay: "ready",
        });
        expect(fake.leaks().sceneObjects).toBe(1);
      }
      session.dispose();
      await settle();
      expect(fake.leaks(), `cycle ${cycle + 1}`).toEqual(noLeaks);
    }
    // Every mounted overlay used its own scene object.
    expect(fake.counts.objects).toBe(fake.counts.started);
    // Three.js resources owned by each component are released on unmount.
    for (const component of fake.components)
      expect(component.outputs.objectRoot).toBeNull();
  });

  it("releases a connection that resolves only after unmount", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const fake = fakeShowcase({
      connect: () => new Promise<void>((resolve) => (release = resolve)),
    });
    const { session } = mount(fake.target);
    await settle();
    session.dispose();
    release();
    await settle();
    expect(fake.counts).toMatchObject({ connections: 1, disconnects: 1 });
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("reconnects with a brand-new scene object and never restarts a stopped one", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase();
    const { session, last } = mount(fake.target);
    await settle();
    fake.playing();
    await settle();
    expect(last().overlay).toBe("ready");
    // An iframe reload calls connect again on the same session.
    void session.connect(fake.target);
    await settle();
    fake.playing();
    await settle();
    expect(last()).toMatchObject({ connection: "connected", overlay: "ready" });
    expect(fake.counts).toMatchObject({
      objects: 2,
      started: 2,
      stopped: 1,
      connections: 2,
      disconnects: 1,
    });
    session.dispose();
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("retries failed simulation dots with a fresh scene object", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase({ startFails: 1 });
    const { session, last } = mount(fake.target);
    await settle();
    fake.playing();
    await settle();
    expect(last()).toMatchObject({
      connection: "connected",
      overlay: "failed",
    });
    expect(fake.leaks().sceneObjects).toBe(0);
    session.retryOverlay();
    await settle();
    expect(last().overlay).toBe("ready");
    expect(fake.counts).toMatchObject({ objects: 2, stopped: 1 });
    session.dispose();
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("restart returns to connecting and drops the old connection", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase();
    const { session, last } = mount(fake.target);
    await settle();
    fake.playing();
    await settle();
    session.restart();
    expect(last()).toMatchObject({
      connection: "connecting",
      overlay: "pending",
      sdk: null,
    });
    expect(fake.leaks()).toEqual(noLeaks);
    session.dispose();
  });
});

describe("labelled viewer failures", () => {
  it("labels a missing bundle (no SDK key at build time)", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase();
    delete (fake.target as { MP_SDK?: unknown }).MP_SDK;
    const { last } = mount(fake.target);
    await settle();
    expect(last()).toMatchObject({ connection: "failed", failure: "bundle" });
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("labels a key refused for the page's domain", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase({
      connect: () =>
        Promise.reject(
          new Error("Application key is not authorized for this domain"),
        ),
    });
    const { last } = mount(fake.target);
    await settle();
    expect(last()).toMatchObject({ connection: "failed", failure: "key" });
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("labels an in-frame key error", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase({
      bodyText: "SDK key is invalid for this domain",
      connect: () => new Promise<void>(() => {}),
    });
    const { last } = mount(fake.target);
    await settle();
    expect(last()).toMatchObject({ connection: "failed", failure: "key" });
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("labels an unavailable model", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase({
      bodyText: "Oops, this space is not available",
      connect: () => new Promise<void>(() => {}),
    });
    const { last } = mount(fake.target);
    await settle();
    expect(last()).toMatchObject({ connection: "failed", failure: "model" });
  });

  it("labels a viewer that never reaches PLAYING as a timeout", async () => {
    vi.useFakeTimers();
    const fake = fakeShowcase();
    const { last } = mount(fake.target);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(last()).toMatchObject({ connection: "failed", failure: "timeout" });
    expect(fake.leaks()).toEqual(noLeaks);
  });

  it("labels a frame that is missing entirely", async () => {
    const session = createViewerSession({
      config: () => ({ placement }),
      replay: () => replay,
      select: () => {},
      onChange: () => {},
    });
    await session.connect(null);
    expect(session.state()).toMatchObject({ failure: "bundle" });
  });

  it("explains every failure and points hosted sandbox keys at the production-key decision", () => {
    expect(failureStatus("key", "bizbox.vercel.app")).toMatch(
      /sandbox key works only on localhost.*plain public embed.*Modeled layout/,
    );
    expect(failureStatus("key", "localhost")).not.toMatch(/sandbox/);
    expect(failureStatus("bundle")).toMatch(/not installed.*public embed/);
    expect(failureStatus("timeout")).toMatch(/did not respond.*public embed/);
    expect(failureStatus("model")).toMatch(/unavailable.*Modeled layout/);
    expect(failureStatus("unavailable")).toMatch(/Unable to connect/);
    expect(publicEmbedUrl("qfmMbTLt4Bo")).toBe(
      "https://my.matterport.com/show?m=qfmMbTLt4Bo&play=1&qs=1",
    );
    expect(publicEmbedUrl("qfmMbTLt4Bo")).not.toMatch(/applicationKey/);
  });
});

vi.mock("../simulator/render-palette", async (original) => ({
  ...(await original<typeof import("../simulator/render-palette")>()),
  readRenderPalette: () => fixtureRenderPalette(),
}));
