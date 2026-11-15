/**
 * Starts Cesium's Draco and KTX2 decoder workers before tile content streams
 * (HAC-177).
 *
 * Cesium creates these workers lazily, when the first tile arrives. By then the
 * tileset has queued ~18 tile downloads, and the worker scripts and wasm
 * binaries wait behind them, so no tile can be decoded (and nothing renders)
 * until the initial view has downloaded. Starting the same singletons Cesium
 * later uses lets the decoders load on an idle connection.
 *
 * Both singletons are private SDK members, so every access is guarded: if a
 * future SDK changes them, this resolves immediately and Cesium falls back to
 * its own lazy initialization.
 */

type TaskProcessorLike = {
  initWebAssemblyModule(options: { wasmBinaryFile: string }): Promise<unknown>;
};

const isObject = (value: unknown): value is object =>
  (typeof value === "object" || typeof value === "function") && value !== null;

function startDraco(
  sdk: object,
): (() => "ready" | "pending" | "failed") | undefined {
  const draco: unknown = Reflect.get(sdk, "DracoLoader");
  if (!isObject(draco)) return undefined;
  const start: unknown = Reflect.get(draco, "_getDecoderTaskProcessor");
  if (typeof start !== "function") return undefined;
  Reflect.apply(start, draco, []);
  return () =>
    Reflect.get(draco, "_taskProcessorReady") === true
      ? "ready"
      : Reflect.get(draco, "_error") !== undefined
        ? "failed"
        : "pending";
}

function startKtx2(sdk: object): Promise<unknown> | undefined {
  const ktx2: unknown = Reflect.get(sdk, "KTX2Transcoder");
  if (!isObject(ktx2)) return undefined;
  const existing: unknown = Reflect.get(ktx2, "_readyPromise");
  if (existing instanceof Promise) return existing;
  const processor: unknown = Reflect.get(ktx2, "_transcodeTaskProcessor");
  if (
    !isObject(processor) ||
    typeof Reflect.get(processor, "initWebAssemblyModule") !== "function"
  )
    return undefined;
  const typed = processor as TaskProcessorLike;
  // Mirrors KTX2Transcoder's own makeReadyPromise, so Cesium reuses it.
  const ready = typed
    .initWebAssemblyModule({
      wasmBinaryFile: "ThirdParty/basis_transcoder.wasm",
    })
    .then((result) => {
      if (result) return processor;
      throw new Error("KTX2 transcoder could not be initialized.");
    });
  Reflect.set(ktx2, "_readyPromise", ready);
  return ready;
}

/**
 * Resolves once both decoders are ready (or failed, or `timeoutMs` passed);
 * it never rejects, because a slow decoder must not block the 3D view.
 * `onReady` runs once per decoder that finishes, failed or not.
 */
export function warmTileDecoders(
  sdk: object,
  {
    onReady,
    timeoutMs = 10000,
    pollMs = 50,
    signal,
  }: {
    onReady?: () => void;
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const done = () => onReady?.();
  let draco: ReturnType<typeof startDraco>;
  let ktx2: ReturnType<typeof startKtx2>;
  try {
    draco = startDraco(sdk);
  } catch {
    draco = undefined;
  }
  try {
    ktx2 = startKtx2(sdk);
  } catch {
    ktx2 = undefined;
  }
  const waits: Promise<void>[] = [];
  if (ktx2) waits.push(ktx2.then(done, done));
  else done();
  if (draco) {
    const check = draco;
    waits.push(
      new Promise<void>((resolve) => {
        const tick = () => {
          if (signal?.aborted) return resolve();
          if (check() !== "pending") {
            done();
            return resolve();
          }
          setTimeout(tick, pollMs);
        };
        tick();
      }),
    );
  } else done();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
    void Promise.all(waits).then(finish);
  });
}
