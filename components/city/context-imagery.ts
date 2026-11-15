import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { ImageryProvider, Viewer } from "cesium";

const METADATA_URL = "https://tiles.openfreemap.org/planet";
export const CONTEXT_FLOOR_METERS = -200; // Display underlay only; not measured elevation or simulation geometry.
export const CONTEXT_MESH_HEIGHT = 10_000;
const TILE_SIZE = 512;
export type ContextMeshState = "hidden" | "loading" | "ready" | "unavailable";
export function observeContextMesh(
  viewer: Viewer,
  mesh: import("cesium").Cesium3DTileset,
  changed: (state: ContextMeshState) => void,
) {
  let visible = false,
    previous: ContextMeshState | undefined;
  const stopBefore = viewer.scene.preRender.addEventListener(() => {
    visible = false;
    mesh.show =
      viewer.camera.positionCartographic.height <= CONTEXT_MESH_HEIGHT;
  });
  const stopVisible = mesh.tileVisible.addEventListener(() => {
    visible = true;
  });
  const stopAfter = viewer.scene.postRender.addEventListener(() => {
    const state: ContextMeshState = !mesh.show
      ? "hidden"
      : visible
        ? "ready"
        : mesh.tilesLoaded
          ? "unavailable"
          : "loading";
    if (state !== previous) {
      previous = state;
      changed(state);
    }
  });
  return () => {
    stopBefore();
    stopVisible();
    stopAfter();
  };
}
const CREDIT =
  '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://openmaptiles.org">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
type SDK = typeof import("cesium");
export type ContextFeature = {
  kind: "water" | "land" | "road" | "waterway" | "building" | "place";
  geometry: { x: number; y: number }[][];
  extent: number;
  className: string;
  name?: string;
  rank: number;
};

export function contextMetadata(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid context metadata");
  const data = value as {
    tiles?: unknown;
    minzoom?: unknown;
    maxzoom?: unknown;
  };
  const template = Array.isArray(data.tiles) ? data.tiles[0] : undefined;
  if (
    typeof template !== "string" ||
    !["{z}", "{x}", "{y}"].every((token) => template.includes(token))
  )
    throw new Error("Missing context tile template");
  const url = new URL(template);
  if (
    url.origin !== "https://tiles.openfreemap.org" ||
    !url.pathname.startsWith("/planet/") ||
    url.username ||
    url.password
  )
    throw new Error("Unapproved context source");
  const minzoom = data.minzoom,
    maxzoom = data.maxzoom;
  if (
    typeof minzoom !== "number" ||
    typeof maxzoom !== "number" ||
    !Number.isInteger(minzoom) ||
    !Number.isInteger(maxzoom) ||
    minzoom < 0 ||
    minzoom > 2 ||
    maxzoom < minzoom ||
    maxzoom > 22
  )
    throw new Error("Unsupported context zoom bounds");
  return { template, minzoom, maxzoom };
}

/** Decode source-local coordinates directly; never synthesize roads or footprints. */
export function decodeContextTile(bytes: Uint8Array): ContextFeature[] {
  const tile = new VectorTile(new Pbf(bytes));
  const result: ContextFeature[] = [];
  const kinds = {
    water: "water",
    landcover: "land",
    landuse: "land",
    park: "land",
    transportation: "road",
    waterway: "waterway",
    building: "building",
    place: "place",
  } as const;
  const roads = new Set([
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "minor",
    "residential",
    "service",
    "path",
    "track",
    "pedestrian",
    "steps",
  ]);
  for (const [layerName, kind] of Object.entries(kinds)) {
    const layer = tile.layers[layerName];
    if (!layer) continue;
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      const className = String(feature.properties.class ?? "");
      if (feature.properties.brunnel === "tunnel") continue;
      if (kind === "road" && !roads.has(className)) continue;
      if (
        kind === "place"
          ? feature.type !== 1
          : kind === "road" || kind === "waterway"
            ? feature.type !== 2
            : feature.type !== 3
      )
        continue;
      const name = feature.properties["name:en"] ?? feature.properties.name;
      result.push({
        kind,
        geometry: feature.loadGeometry(),
        extent: feature.extent,
        className,
        ...(typeof name === "string" ? { name: name.slice(0, 80) } : {}),
        rank: Number(feature.properties.rank ?? 0),
      });
    }
  }
  return result;
}

/** Neutral cartographic styling of actual vector features, independent of the business model. */
export function drawContextTile(
  ctx: CanvasRenderingContext2D,
  features: ContextFeature[],
  size: number,
  level: number,
) {
  ctx.fillStyle = "#292c32";
  ctx.fillRect(0, 0, size, size);
  const ordered = [...features].sort(
    (a, b) =>
      ({ land: 0, water: 1, waterway: 2, building: 3, road: 4, place: 5 })[
        a.kind
      ] -
      { land: 0, water: 1, waterway: 2, building: 3, road: 4, place: 5 }[
        b.kind
      ],
  );
  const placed: { x: number; y: number; width: number }[] = [];
  for (const feature of ordered) {
    if (feature.kind === "building" && level < 13) continue;
    const scale = size / feature.extent;
    if (feature.kind === "place") {
      if (
        !feature.name ||
        placed.length >= 12 ||
        feature.rank > (level < 8 ? 3 : level < 12 ? 6 : 10)
      )
        continue;
      const point = feature.geometry[0]?.[0];
      if (!point) continue;
      const x = point.x * scale,
        y = point.y * scale;
      ctx.font = `${feature.className === "city" ? "600 15" : "500 12"}px sans-serif`;
      const width = ctx.measureText(feature.name).width;
      if (
        x - width / 2 < 4 ||
        x + width / 2 > size - 4 ||
        y < 14 ||
        y > size - 14 ||
        placed.some(
          (label) =>
            Math.abs(label.y - y) < 20 &&
            Math.abs(label.x - x) < (label.width + width) / 2 + 8,
        )
      )
        continue;
      placed.push({ x, y, width });
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#202229";
      ctx.strokeText(feature.name, x, y);
      ctx.fillStyle = "#d9dbe2";
      ctx.fillText(feature.name, x, y);
      continue;
    }
    ctx.beginPath();
    for (const line of feature.geometry) {
      line.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
        else ctx.lineTo(point.x * scale, point.y * scale);
      });
      if (feature.kind !== "road" && feature.kind !== "waterway")
        ctx.closePath();
    }
    if (feature.kind === "road" || feature.kind === "waterway") {
      const major = ["motorway", "trunk", "primary"].includes(
        feature.className,
      );
      ctx.lineWidth = feature.kind === "waterway" ? 1.5 : major ? 2.4 : 1;
      ctx.strokeStyle =
        feature.kind === "waterway" ? "#435b6d" : major ? "#8c8990" : "#565b65";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      ctx.fillStyle =
        feature.kind === "water"
          ? "#233e50"
          : feature.kind === "building"
            ? "#555862"
            : ["wood", "forest", "grass", "park"].includes(feature.className)
              ? "#343b40"
              : "#33353d";
      ctx.fill("evenodd");
    }
  }
}

type Entry<T> = {
  key: string;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  active: boolean;
};
/** Bounded work queue + deduplication + LRU. Saturation returns undefined for Cesium retry. */
export class ContextTileCache<T> {
  private ready = new Map<string, T>();
  private entries = new Map<string, Entry<T>>();
  private queue: Entry<T>[] = [];
  private active = 0;
  private disposed = false;
  constructor(
    private load: (key: string, signal: AbortSignal) => Promise<T>,
    private options = { capacity: 64, concurrency: 4, queue: 8 },
  ) {}
  request(key: string): Promise<T> | undefined {
    if (this.disposed) return undefined;
    if (this.ready.has(key)) {
      const value = this.ready.get(key)!;
      this.ready.delete(key);
      this.ready.set(key, value);
      return Promise.resolve(value);
    }
    const existing = this.entries.get(key);
    if (existing) return existing.promise;
    if (
      this.active >= this.options.concurrency &&
      this.queue.length >= this.options.queue
    )
      return undefined;
    let resolve!: Entry<T>["resolve"], reject!: Entry<T>["reject"];
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const entry = {
      key,
      promise,
      resolve,
      reject,
      controller: new AbortController(),
      active: false,
    };
    this.entries.set(key, entry);
    this.queue.push(entry);
    this.pump();
    return promise;
  }
  private pump() {
    while (
      !this.disposed &&
      this.active < this.options.concurrency &&
      this.queue.length
    ) {
      const entry = this.queue.shift()!;
      entry.active = true;
      this.active++;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.active--;
        if (this.entries.get(entry.key) === entry)
          this.entries.delete(entry.key);
        this.pump();
      };
      void this.load(entry.key, entry.controller.signal)
        .then((value) => {
          if (this.disposed || entry.controller.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          this.ready.set(entry.key, value);
          while (this.ready.size > this.options.capacity)
            this.ready.delete(this.ready.keys().next().value!);
          finish();
          entry.resolve(value);
        })
        .catch((error: unknown) => {
          finish();
          entry.reject(error);
        });
    }
  }
  cancel(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.controller.abort();
    if (!entry.active) {
      this.queue = this.queue.filter((item) => item !== entry);
      entry.reject(new DOMException("Aborted", "AbortError"));
      this.entries.delete(key);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.entries.keys()) this.cancel(key);
    this.ready.clear();
  }
}

export function createContextGlobe(sdk: SDK) {
  const globe = new sdk.Globe(sdk.Ellipsoid.WGS84);
  globe.terrainProvider = new sdk.CustomHeightmapTerrainProvider({
    width: 32,
    height: 32,
    callback: () => new Float32Array(32 * 32).fill(CONTEXT_FLOOR_METERS),
  });
  globe.baseColor = sdk.Color.fromCssColorString("#292c32");
  globe.enableLighting = false;
  globe.tileCacheSize = 64;
  return globe;
}

/** Same approved source, same Viewer. Errors preserve source imagery and never create fake geography. */
export function attachContextImagery(
  viewer: Viewer,
  sdk: SDK,
  callbacks: { ready: () => void; error: () => void },
) {
  const controller = new AbortController();
  let disposed = false,
    first = true;
  let cache: ContextTileCache<HTMLCanvasElement> | undefined;
  let layer: import("cesium").ImageryLayer | undefined;
  void (async () => {
    const response = await fetch(METADATA_URL, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error("Map context metadata unavailable");
    const metadata = contextMetadata(await response.json());
    if (disposed) return;
    cache = new ContextTileCache(async (key, signal) => {
      const [z, x, y] = key.split("/");
      const url = metadata.template
        .replace("{z}", z)
        .replace("{x}", x)
        .replace("{y}", y);
      const tile = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!tile.ok) throw new Error("Map context tile unavailable");
      const bytes = new Uint8Array(await tile.arrayBuffer());
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const canvas = document.createElement("canvas");
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Map context canvas unavailable");
      drawContextTile(context, decodeContextTile(bytes), TILE_SIZE, Number(z));
      if (first && !disposed) {
        first = false;
        callbacks.ready();
      }
      return canvas;
    });
    const tilingScheme = new sdk.WebMercatorTilingScheme();
    const credit = new sdk.Credit(CREDIT, true);
    const provider = {
      tilingScheme,
      rectangle: tilingScheme.rectangle,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      minimumLevel: metadata.minzoom,
      maximumLevel: metadata.maxzoom,
      hasAlphaChannel: false,
      tileDiscardPolicy: undefined,
      proxy: undefined,
      credit,
      errorEvent: new sdk.Event(),
      getTileCredits: () => [credit],
      pickFeatures: () => undefined,
      requestImage: (
        x: number,
        y: number,
        z: number,
        request?: import("cesium").Request,
      ) => {
        if (
          disposed ||
          !Number.isInteger(z) ||
          z < metadata.minzoom ||
          z > metadata.maxzoom ||
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          y < 0 ||
          x >= 2 ** z ||
          y >= 2 ** z
        )
          return undefined;
        const key = `${z}/${x}/${y}`;
        if (request) request.cancelFunction = () => cache?.cancel(key);
        return cache!.request(key)?.catch((error: unknown) => {
          if (
            !disposed &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            callbacks.error();
          throw error;
        });
      },
    } as unknown as ImageryProvider;
    layer = viewer.imageryLayers.addImageryProvider(provider);
    viewer.scene.requestRender();
  })().catch(() => {
    if (!disposed) callbacks.error();
  });
  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      cache?.dispose();
      if (layer && !viewer.isDestroyed())
        viewer.imageryLayers.remove(layer, true);
    },
  };
}
