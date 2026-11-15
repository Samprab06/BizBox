import { afterEach, describe, expect, it, vi } from "vitest";
import Pbf from "pbf";
import {
  contextMetadata,
  decodeContextTile,
  drawContextTile,
  ContextTileCache,
  observeContextMesh,
  attachContextImagery,
} from "./context-imagery";
afterEach(() => vi.unstubAllGlobals());

// Hand-authored MVT fixture: source polygons/line/label, never business/location data.
function tileFixture() {
  const tile = new Pbf();
  for (const [name, type, geometry, properties] of [
    [
      "water",
      3,
      [9, 0, 0, 26, 8192, 0, 0, 8192, 8191, 0, 15],
      { class: "lake" },
    ],
    ["transportation", 2, [9, 0, 4096, 10, 8192, 0], { class: "primary" }],
    ["building", 3, [9, 100, 100, 26, 100, 0, 0, 100, 99, 0, 15], {}],
    [
      "place",
      1,
      [9, 4096, 4096],
      { name: "Invented fixture town", class: "city" },
    ],
  ] as const)
    tile.writeMessage(
      3,
      (_, layer) => {
        layer.writeStringField(1, name);
        layer.writeVarintField(15, 2);
        layer.writeVarintField(5, 4096);
        const entries = Object.entries(properties);
        for (const [key, value] of entries) {
          layer.writeStringField(3, key);
          layer.writeMessage(
            4,
            (_, v) => v.writeStringField(1, String(value)),
            null,
          );
        }
        layer.writeMessage(
          2,
          (_, feature) => {
            feature.writeVarintField(3, type);
            feature.writePackedVarint(
              2,
              entries.flatMap((_, i) => [i, i]),
            );
            feature.writePackedVarint(4, [...geometry]);
          },
          null,
        );
      },
      null,
    );
  return tile.finish();
}
describe("real vector geographic context", () => {
  it("starts at most four source fetches, bounds queued work and aborts all queued/active requests", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((_key: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>((_resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      );
    });
    const cache = new ContextTileCache(load);
    const requests = Array.from({ length: 12 }, (_, index) =>
      cache.request(String(index))!,
    );
    expect(load).toHaveBeenCalledTimes(4);
    expect(cache.request("overflow")).toBeUndefined();
    cache.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(
      (await Promise.allSettled(requests)).every(
        (result) => result.status === "rejected",
      ),
    ).toBe(true);
  });
  it("uses actual metadata/tile URLs, retries failures, establishes readiness only after rasterization and disposes imagery", async () => {
    let provider: import("cesium").ImageryProvider | undefined;
    const ctx = new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "measureText" ? () => ({ width: 100 }) : () => {},
        set: () => true,
      },
    );
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    vi.stubGlobal("document", { createElement: () => canvas });
    let fail = true;
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("/planet")
        ? Response.json({
            tiles: [
              "https://tiles.openfreemap.org/planet/release/{z}/{x}/{y}.pbf",
            ],
            minzoom: 0,
            maxzoom: 14,
            attribution: "<script>untrusted</script>",
          })
        : fail
          ? new Response(null, { status: 503 })
          : new Response(Uint8Array.from(tileFixture()).buffer),
    );
    vi.stubGlobal("fetch", fetcher);
    const remove = vi.fn(),
      ready = vi.fn(),
      error = vi.fn();
    const viewer = {
      imageryLayers: {
        addImageryProvider: (value: import("cesium").ImageryProvider) => {
          provider = value;
          return {};
        },
        remove,
      },
      scene: { requestRender: vi.fn() },
      isDestroyed: () => false,
    };
    const sdk = {
      WebMercatorTilingScheme: class {
        rectangle = {};
      },
      Credit: class {
        constructor(public text: string) {}
      },
      Event: class {},
    } as unknown as typeof import("cesium");
    const attachment = attachContextImagery(
      viewer as unknown as import("cesium").Viewer,
      sdk,
      { ready, error },
    );
    await vi.waitFor(() => expect(provider).toBeDefined());
    expect(ready).not.toHaveBeenCalled();
    expect(provider!.maximumLevel).toBe(14);
    expect(provider!.requestImage(0, 0, 15)).toBeUndefined();
    await expect(provider!.requestImage(480, 846, 11)).rejects.toThrow(
      "Map context tile unavailable",
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    fail = false;
    await provider!.requestImage(480, 846, 11);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
      "https://tiles.openfreemap.org/planet/release/11/480/846.pbf",
    );
    await provider!.requestImage(480, 846, 11);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((provider!.credit as unknown as { text: string }).text).toContain(
      "OpenMapTiles",
    );
    expect(
      (provider!.credit as unknown as { text: string }).text,
    ).not.toContain("script");
    attachment.destroy();
    attachment.destroy();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(provider!.requestImage(480, 846, 11)).toBeUndefined();
  });
  it("shows mesh only close up and settles an uncovered view without blocking real map context", () => {
    const listeners = { pre: () => {}, post: () => {}, tile: () => {} };
    const stopped = vi.fn();
    const changed = vi.fn();
    const viewer = {
      camera: { positionCartographic: { height: 80_000 } },
      scene: {
        preRender: {
          addEventListener: (fn: () => void) => {
            listeners.pre = fn;
            return stopped;
          },
        },
        postRender: {
          addEventListener: (fn: () => void) => {
            listeners.post = fn;
            return stopped;
          },
        },
      },
    };
    const mesh = {
      show: true,
      tilesLoaded: false,
      tileVisible: {
        addEventListener: (fn: () => void) => {
          listeners.tile = fn;
          return stopped;
        },
      },
    };
    const dispose = observeContextMesh(
      viewer as unknown as import("cesium").Viewer,
      mesh as unknown as import("cesium").Cesium3DTileset,
      changed,
    );
    listeners.pre();
    listeners.post();
    expect(mesh.show).toBe(false);
    expect(changed).toHaveBeenLastCalledWith("hidden");
    viewer.camera.positionCartographic.height = 2500;
    listeners.pre();
    listeners.post();
    expect(mesh.show).toBe(true);
    expect(changed).toHaveBeenLastCalledWith("loading");
    listeners.pre();
    listeners.tile();
    listeners.post();
    expect(changed).toHaveBeenLastCalledWith("ready");
    mesh.tilesLoaded = true;
    listeners.pre();
    listeners.post();
    expect(changed).toHaveBeenLastCalledWith("unavailable");
    dispose();
    expect(stopped).toHaveBeenCalledTimes(3);
  });
  it("honors actual metadata zoom bounds and restricts requests to the existing source", () => {
    expect(
      contextMetadata({
        tiles: ["https://tiles.openfreemap.org/planet/release/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 14,
      }),
    ).toMatchObject({ minzoom: 0, maxzoom: 14 });
    expect(() =>
      contextMetadata({
        tiles: ["https://other.invalid/{z}/{x}/{y}"],
        minzoom: 0,
        maxzoom: 14,
      }),
    ).toThrow();
  });
  it("decodes actual MVT geometry/classes/names and renders source features at tile coordinates", () => {
    const features = decodeContextTile(tileFixture());
    expect(features.map((f) => f.kind)).toEqual([
      "water",
      "road",
      "building",
      "place",
    ]);
    expect(features[0].geometry[0][1]).toEqual({ x: 4096, y: 0 });
    expect(features[3].name).toBe("Invented fixture town");
    const calls: string[] = [];
    const ctx = new Proxy(
      { measureText: () => ({ width: 100 }) },
      {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target];
          return (...args: unknown[]) =>
            calls.push(`${String(key)}:${args.join(",")}`);
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawContextTile(ctx, features, 512, 14);
    expect(calls).toContain("lineTo:512,0");
    expect(
      calls.some((call) =>
        call.startsWith("fillText:Invented fixture town,256,256"),
      ),
    ).toBe(true);
    expect(calls.some((call) => call === "fill:evenodd")).toBe(true);
  });
  it("deduplicates, bounds concurrency/cache, retries failures and aborts work on disposal", async () => {
    const waiting = new Map<
      string,
      {
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        signal: AbortSignal;
      }
    >();
    const load = vi.fn(
      (key: string, signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          waiting.set(key, { resolve, reject, signal });
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const cache = new ContextTileCache(load, {
      capacity: 2,
      concurrency: 1,
      queue: 1,
    });
    const a = cache.request("a")!,
      same = cache.request("a");
    expect(same).toBe(a);
    const b = cache.request("b")!;
    expect(cache.request("c")).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
    waiting.get("a")!.resolve("A");
    await a;
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    waiting.get("b")!.resolve("B");
    await b;
    expect(await cache.request("a")).toBe("A");
    const c = cache.request("c")!;
    waiting.get("c")!.reject(new Error("network"));
    await expect(c).rejects.toThrow("network");
    await Promise.resolve();
    const retry = cache.request("c")!;
    waiting.get("c")!.resolve("C");
    await retry;
    const reloaded = cache.request("b")!;
    expect(load.mock.calls.filter(([key]) => key === "b")).toHaveLength(2);
    cache.dispose();
    await expect(reloaded).rejects.toThrow("aborted");
    expect(waiting.get("b")!.signal.aborted).toBe(true);
    expect(cache.request("later")).toBeUndefined();
  });
});
