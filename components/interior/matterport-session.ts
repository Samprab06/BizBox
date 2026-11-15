import {
  ViewerError,
  connectShowcase,
  focusServiceArea,
  viewerFailure,
  waitForPlaying,
  type MatterportSdk,
  type ServiceViewpoint,
  type ShowcaseWindow,
  type ViewerFailure,
} from "./matterport-bridge";
import {
  attachReplayScene,
  type ScanPlacement,
  type ScanReplay,
} from "./matterport-scene";

/** The keyless public embed: a real scan, but no overlay or camera control. */
export function publicEmbedUrl(modelId: string) {
  return `https://my.matterport.com/show?${new URLSearchParams({
    m: modelId,
    play: "1",
    qs: "1",
  })}`;
}

const embedNote =
  "Showing the plain public embed instead: no simulation dots or camera control. Choose Modeled layout above to inspect the replay.";
export function failureStatus(failure: ViewerFailure | undefined, host = "") {
  const local = host === "localhost";
  switch (failure) {
    case "key":
      return `The Matterport SDK key was refused for ${host || "this domain"}. ${
        local
          ? ""
          : "A sandbox key works only on localhost; a hosted URL needs a production key with its domain allow-listed. "
      }${embedNote}`;
    case "bundle":
      return `The Matterport SDK viewer is not installed on this deployment. ${embedNote}`;
    case "timeout":
      return `The scanned interior did not respond in time. ${embedNote}`;
    case "model":
      return "The public café scan is unavailable right now. Choose Modeled layout above to inspect the replay.";
    default:
      return `Unable to connect to the scanned interior. ${embedNote}`;
  }
}

export type ViewerState = {
  connection: "connecting" | "connected" | "failed";
  failure?: ViewerFailure;
  overlay: "pending" | "ready" | "failed";
  focusFailed: boolean;
  sdk: MatterportSdk | null;
};
export const initialViewerState: ViewerState = {
  connection: "connecting",
  overlay: "pending",
  focusFailed: false,
  sdk: null,
};

export type ViewerSessionOptions = {
  /** Read at each attach so the latest calibration is used. */
  config(): { placement?: ScanPlacement; viewpoint?: ServiceViewpoint };
  replay(): ScanReplay;
  select(id: string): void;
  onChange(state: ViewerState): void;
  timeoutMs?: number;
};
export type ViewerSession = ReturnType<typeof createViewerSession>;

/**
 * Owns one viewer's SDK connection, PLAYING wait and simulation scene. Every
 * connect or retry tears down what came before and builds a new scene object,
 * and dispose() releases the connection, timers, listeners and scene objects.
 * It has no React dependency so mount/unmount cycles are unit-testable.
 */
export function createViewerSession(options: ViewerSessionOptions) {
  let state = initialViewerState;
  let disposed = false;
  let connection: AbortController | null = null;
  let overlay: AbortController | null = null;
  let sdk: MatterportSdk | null = null;
  let layer: Awaited<ReturnType<typeof attachReplayScene>> | null = null;

  const set = (next: Partial<ViewerState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    options.onChange(state);
  };
  const stopOverlay = () => {
    overlay?.abort();
    overlay = null;
    layer?.dispose();
    layer = null;
  };
  const teardown = () => {
    connection?.abort();
    connection = null;
    stopOverlay();
    const previous = sdk;
    sdk = null;
    try {
      previous?.disconnect?.();
    } catch {
      // A frame that already navigated away has nothing left to close.
    }
  };

  async function startOverlay() {
    const placement = options.config().placement;
    stopOverlay();
    const current = sdk;
    if (!current || !placement || disposed) return;
    const attempt = new AbortController();
    overlay = attempt;
    set({ overlay: "pending" });
    try {
      const created = await attachReplayScene(
        current,
        placement,
        options.replay(),
        (id) => options.select(id),
        attempt.signal,
      );
      if (attempt.signal.aborted) {
        created.dispose();
        return;
      }
      layer = created;
      created.update(options.replay(), placement);
      set({ overlay: "ready" });
    } catch {
      if (!attempt.signal.aborted) set({ overlay: "failed" });
    }
  }

  return {
    state: () => state,
    /** Called on every SDK iframe load; a reload is a full reconnect. */
    async connect(target: ShowcaseWindow | null) {
      if (disposed) return;
      teardown();
      const attempt = new AbortController();
      connection = attempt;
      set({ ...initialViewerState, failure: undefined });
      try {
        if (!target) throw new ViewerError("bundle", "Viewer SDK unavailable");
        const connected = await connectShowcase(
          target,
          attempt.signal,
          options.timeoutMs,
        );
        if (attempt.signal.aborted) {
          connected.disconnect?.();
          return;
        }
        sdk = connected;
        await waitForPlaying(connected, attempt.signal, options.timeoutMs);
        const viewpoint = options.config().viewpoint;
        let focusFailed = false;
        if (viewpoint)
          await focusServiceArea(connected, viewpoint).catch(() => {
            focusFailed = true;
          });
        if (attempt.signal.aborted) return;
        set({ connection: "connected", sdk: connected, focusFailed });
        await startOverlay();
      } catch (error) {
        if (attempt.signal.aborted) return;
        teardown();
        set({
          connection: "failed",
          failure: viewerFailure(error),
          sdk: null,
        });
      }
    },
    /** Return to "connecting" before the caller reloads the iframe. */
    restart() {
      if (disposed) return;
      teardown();
      set({ ...initialViewerState, failure: undefined });
    },
    /** A failed or stopped scene cannot restart; build a new one. */
    retryOverlay() {
      void startOverlay();
    },
    async focus() {
      const viewpoint = options.config().viewpoint;
      if (!sdk || !viewpoint) return;
      set({ focusFailed: false });
      await focusServiceArea(sdk, viewpoint).catch(() =>
        set({ focusFailed: true }),
      );
    },
    update(replay: ScanReplay) {
      layer?.update(replay, options.config().placement);
    },
    dispose() {
      if (disposed) return;
      teardown();
      disposed = true;
    },
  };
}
