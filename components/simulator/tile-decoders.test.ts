import { afterEach, describe, expect, it, vi } from "vitest";
import { warmTileDecoders } from "./tile-decoders";

function fakeSdk({
  dracoReadyAfter = 0,
  ktx2Result = true,
}: { dracoReadyAfter?: number; ktx2Result?: boolean } = {}) {
  const DracoLoader = {
    _taskProcessorReady: false as boolean,
    _error: undefined as unknown,
    _decoderTaskProcessor: undefined as unknown,
    _getDecoderTaskProcessor: vi.fn(function () {
      DracoLoader._decoderTaskProcessor ??= {};
      setTimeout(() => {
        DracoLoader._taskProcessorReady = true;
      }, dracoReadyAfter);
      return DracoLoader._decoderTaskProcessor;
    }),
  };
  const processor = {
    initWebAssemblyModule: vi.fn(() => Promise.resolve(ktx2Result)),
  };
  const KTX2Transcoder = {
    _transcodeTaskProcessor: processor,
    _readyPromise: undefined as Promise<unknown> | undefined,
  };
  return { DracoLoader, KTX2Transcoder, processor };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("warmTileDecoders", () => {
  it("starts Cesium's own Draco and KTX2 singletons and waits for both", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ dracoReadyAfter: 120 });
    const onReady = vi.fn();
    let resolved = false;
    const warm = warmTileDecoders(sdk, { onReady }).then(() => {
      resolved = true;
    });
    expect(sdk.DracoLoader._getDecoderTaskProcessor).toHaveBeenCalledTimes(1);
    expect(sdk.processor.initWebAssemblyModule).toHaveBeenCalledWith({
      wasmBinaryFile: "ThirdParty/basis_transcoder.wasm",
    });
    // Cesium's KTX2Transcoder.transcode reuses this promise instead of
    // creating its own.
    await expect(sdk.KTX2Transcoder._readyPromise).resolves.toBe(sdk.processor);
    await vi.advanceTimersByTimeAsync(60);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(120);
    await warm;
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(resolved).toBe(true);
  });

  it("reuses a KTX2 transcoder Cesium already started", async () => {
    const sdk = fakeSdk();
    const existing = Promise.resolve("started");
    sdk.KTX2Transcoder._readyPromise = existing;
    await warmTileDecoders(sdk);
    expect(sdk.processor.initWebAssemblyModule).not.toHaveBeenCalled();
    expect(sdk.KTX2Transcoder._readyPromise).toBe(existing);
  });

  it("never rejects when a decoder fails, and still reports it finished", async () => {
    const sdk = fakeSdk({ ktx2Result: false });
    const onReady = vi.fn();
    await expect(warmTileDecoders(sdk, { onReady })).resolves.toBeUndefined();
    expect(onReady).toHaveBeenCalledTimes(2);
    await expect(sdk.KTX2Transcoder._readyPromise).rejects.toThrow(
      "KTX2 transcoder could not be initialized.",
    );
  });

  it("stops waiting at the timeout so a slow decoder cannot block the view", async () => {
    vi.useFakeTimers();
    const sdk = fakeSdk({ dracoReadyAfter: 60_000 });
    let resolved = false;
    void warmTileDecoders(sdk, { timeoutMs: 500 }).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("resolves at once when aborted", async () => {
    const sdk = fakeSdk({ dracoReadyAfter: 60_000 });
    const controller = new AbortController();
    const warm = warmTileDecoders(sdk, { signal: controller.signal });
    controller.abort();
    await expect(warm).resolves.toBeUndefined();
  });

  it("falls back to Cesium's lazy start when the private members are missing", async () => {
    const onReady = vi.fn();
    await expect(warmTileDecoders({}, { onReady })).resolves.toBeUndefined();
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("matches the real Cesium SDK members it relies on", async () => {
    // Pinned SDK: if an upgrade renames these, this fails before users wait.
    const sdk: object = await import("cesium");
    const draco: unknown = Reflect.get(sdk, "DracoLoader");
    const ktx2: unknown = Reflect.get(sdk, "KTX2Transcoder");
    expect(draco).toBeTypeOf("function");
    expect(ktx2).toBeTypeOf("function");
    expect(
      typeof Reflect.get(draco as object, "_getDecoderTaskProcessor"),
    ).toBe("function");
    const processor: unknown = Reflect.get(
      ktx2 as object,
      "_transcodeTaskProcessor",
    );
    expect(processor).toBeTypeOf("object");
    expect(
      typeof Reflect.get(processor as object, "initWebAssemblyModule"),
    ).toBe("function");
  });
});
