import type { MatterportSceneSdk } from "./matterport-scene";

export type Subscription = { cancel(): void };
export type MatterportSdk = MatterportSceneSdk & {
  Sweep?: {
    moveTo(
      id: string,
      options: { rotation: { x: number; y: number }; transition: string },
    ): Promise<unknown>;
    Transition: { INSTANT: string };
  };
  /** Closes the iframe connection; absent from older bundle builds. */
  disconnect?(): void;
  App: {
    state: {
      subscribe(callback: (state: { phase: string }) => void): Subscription;
    };
    Phase?: { PLAYING: string };
  };
};
export type ShowcaseWindow = Window & {
  MP_SDK?: { connect(target: Window): Promise<MatterportSdk> };
  MutationObserver?: typeof MutationObserver;
};
export type ServiceViewpoint = {
  sweepId: string;
  rotation: { x: number; y: number };
};

/** Why the SDK viewer could not open, so the view can label its fallback. */
export type ViewerFailure =
  "cancelled" | "timeout" | "bundle" | "key" | "model" | "unavailable";
export class ViewerError extends Error {
  constructor(
    readonly reason: ViewerFailure,
    message: string,
  ) {
    super(message);
    this.name = "ViewerError";
  }
}
// Key and domain refusals arrive as rejected connects or in-frame error text.
const keyRefusal =
  /(?:application|sdk|api)[ _-]?key|applicationkey|domain|origin|unauthori[sz]ed|not authori[sz]ed|forbidden|\b403\b|access denied/i;
export function viewerFailure(error: unknown): ViewerFailure {
  if (error instanceof ViewerError) return error.reason;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return keyRefusal.test(message) ? "key" : "unavailable";
}

/** Bound connection itself; a provider promise may otherwise never settle. */
export function connectShowcase(
  target: ShowcaseWindow,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<MatterportSdk> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let observer: MutationObserver | undefined;
    const complete = (error?: Error, sdk?: MatterportSdk) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      observer?.disconnect();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(sdk!);
    };
    const abort = () =>
      complete(new ViewerError("cancelled", "Viewer connection cancelled"));
    const timeout = setTimeout(
      () => complete(new ViewerError("timeout", "Viewer connection timed out")),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      const checkUnavailable = () => {
        const text = target.document?.body?.textContent ?? "";
        if (
          /oops[!,.]|(?:model|space).{0,40}(?:not available|unavailable|not found)/is.test(
            text,
          )
        )
          complete(new ViewerError("model", "Viewer model unavailable"));
        else if (
          /(?:application|sdk) ?key\b.{0,60}(?:invalid|not (?:valid|authori[sz]ed|allowed)|refused|domain)/is.test(
            text,
          )
        )
          complete(new ViewerError("key", "Viewer SDK key refused"));
      };
      if (target.MutationObserver && target.document?.body) {
        observer = new target.MutationObserver(checkUnavailable);
        observer.observe(target.document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        checkUnavailable();
      }
      if (!target.MP_SDK) {
        // Without MATTERPORT_SDK_KEY at build time the bundle page is a 404.
        complete(new ViewerError("bundle", "Viewer SDK unavailable"));
        return;
      }
      if (!finished)
        void Promise.resolve()
          .then(() => target.MP_SDK!.connect(target))
          .then(
            (sdk) => {
              if (finished) sdk.disconnect?.();
              complete(undefined, sdk);
            },
            (error: unknown) =>
              complete(
                new ViewerError(
                  viewerFailure(error),
                  "Viewer connection unavailable",
                ),
              ),
          );
    } catch (error) {
      // A cross-origin or detached frame throws on access.
      complete(
        new ViewerError(viewerFailure(error), "Viewer connection unavailable"),
      );
    }
  });
}

export async function focusServiceArea(
  sdk: MatterportSdk,
  viewpoint: ServiceViewpoint,
) {
  if (!sdk.Sweep) throw new Error("Service area navigation unavailable");
  await sdk.Sweep.moveTo(viewpoint.sweepId, {
    rotation: viewpoint.rotation,
    transition: sdk.Sweep.Transition.INSTANT,
  });
}

/** Cancel the observable and timeout on every outcome, including synchronous delivery. */
export function waitForPlaying(
  sdk: MatterportSdk,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let subscription: Subscription | undefined;
    let finished = false;
    const complete = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      subscription?.cancel();
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      complete(new ViewerError("cancelled", "Viewer connection cancelled"));
    const timeout = setTimeout(
      () => complete(new ViewerError("timeout", "Viewer connection timed out")),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      subscription = sdk.App.state.subscribe((state) => {
        if (state.phase === (sdk.App.Phase?.PLAYING ?? "appphase.playing"))
          complete();
      });
      if (finished) subscription.cancel();
    } catch {
      complete(new Error("Viewer state unavailable"));
    }
  });
}
