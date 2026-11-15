import { readRenderPalette } from "../simulator/render-palette";
import type * as Three from "three";
import type { interiorFrame } from "../simulator/interior-state";
import { scanLayout } from "./scan-layout";

export type ScanPlacement = {
  origin: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
};
export type ScanReplay = {
  frame: ReturnType<typeof interiorFrame>;
  selected: string;
  stationCount: number;
};

type SceneObject = {
  addNode(): {
    addComponent(
      name: string,
      inputs: ReplayComponent["inputs"],
    ): ReplayComponent;
  };
  start(): void | Promise<void>;
  stop(): void;
};
export type MatterportSceneSdk = {
  Scene: {
    /** Resolves to a disposable registration in current bundles. */
    register(
      name: string,
      factory: () => ReplayComponent,
    ): Promise<{ dispose?(): void } | void | unknown>;
    createObjects(count: number): Promise<SceneObject[]>;
  };
};

/** Shared view-normal lighting: readable spheres without changing scan lights. */
function markerTextures(THREE: typeof Three) {
  const size = 64;
  const surface = new Uint8Array(size * size * 4);
  const shadow = new Uint8Array(surface.length);
  const lightLength = Math.hypot(-0.45, 0.65, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1)) * 2 - 1;
      const ny = (y / (size - 1)) * 2 - 1;
      const radiusSquared = nx * nx + ny * ny;
      const nz = Math.sqrt(Math.max(0, 1 - radiusSquared));
      const diffuse = Math.max(0, (-0.45 * nx + 0.65 * ny + nz) / lightLength);
      const highlight = Math.exp(
        -((nx + 0.32) ** 2 + (ny - 0.48) ** 2) / 0.035,
      );
      const shade = Math.round(
        255 * Math.min(1, 0.12 + 0.76 * diffuse + 0.5 * highlight),
      );
      const index = (y * size + x) * 4;
      surface.set([shade, shade, shade, 255], index);
      shadow[index + 3] = Math.round(80 * Math.max(0, 1 - radiusSquared) ** 2);
    }
  }
  return [surface, shadow].map((pixels) => {
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  });
}

/** All runtime WebGL constructors come from Showcase, never from the app's Three copy. */
export class ReplayComponent {
  context!: { three: typeof Three };
  inputs: { replay: ScanReplay; placement: ScanPlacement };
  // Reserved outputs are injected by the SDK before lifecycle callbacks.
  outputs: { objectRoot?: Three.Group | null; collider?: Three.Group | null } =
    {};
  events = { "INTERACTION.CLICK": true };
  private dots = new Map<string, Three.Group>();
  private counters: Three.Mesh[] = [];
  private geometries: Three.BufferGeometry[] = [];
  private materials: Three.Material[] = [];
  private textures: Three.Texture[] = [];
  private destroyed = false;

  constructor(
    replay: ScanReplay,
    placement: ScanPlacement,
    private select: (id: string) => void,
    private initialized: () => void = () => {},
  ) {
    this.inputs = { replay, placement };
  }
  onInit() {
    const THREE = this.context.three;
    const palette = readRenderPalette();
    this.textures = markerTextures(THREE);
    this.geometries = [
      new THREE.SphereGeometry(0.4, 24, 16),
      new THREE.TorusGeometry(0.52, 0.025, 5, 24),
      new THREE.BoxGeometry(2.1, 0.06, 0.8),
      new THREE.PlaneGeometry(1.12, 1.12),
    ];
    this.materials = [
      new THREE.MeshMatcapMaterial({
        color: palette["agent-customer"],
        matcap: this.textures[0],
        depthTest: true,
      }),
      new THREE.MeshMatcapMaterial({
        color: palette["agent-employee"],
        matcap: this.textures[0],
        depthTest: true,
      }),
      new THREE.MeshBasicMaterial({ color: palette.ink, depthTest: true }),
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        depthTest: true,
      }),
      new THREE.MeshBasicMaterial({
        map: this.textures[1],
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    ];
    this.outputs.objectRoot = new THREE.Group();
    this.outputs.collider = this.outputs.objectRoot;
    this.onInputsUpdated();
    this.initialized();
  }
  onInputsUpdated() {
    const root = this.outputs.objectRoot;
    if (!root || this.destroyed) return;
    const THREE = this.context.three;
    const { replay, placement } = this.inputs;
    root.position.set(
      placement.origin.x,
      placement.origin.y,
      placement.origin.z,
    );
    root.rotation.y = placement.rotationY;
    root.scale.setScalar(placement.scale);
    const layout = scanLayout(replay.frame, replay.stationCount);
    const desired = layout.people;
    const ids = new Set(desired.map((dot) => dot.id));
    for (const [id, group] of this.dots)
      if (!ids.has(id)) {
        root.remove(group);
        this.dots.delete(id);
      }
    for (const dot of desired) {
      let group = this.dots.get(dot.id);
      if (!group) {
        group = new THREE.Group();
        group.add(
          new THREE.Mesh(
            this.geometries[0],
            this.materials[dot.role === "employee" ? 1 : 0],
          ),
        );
        const outline = new THREE.Mesh(this.geometries[1], this.materials[2]);
        outline.rotation.x = -Math.PI / 2;
        outline.position.y = -0.38;
        group.add(outline);
        const shadow = new THREE.Mesh(this.geometries[3], this.materials[4]);
        shadow.userData.role = "contact-shadow";
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = -0.385;
        group.add(shadow);
        this.dots.set(dot.id, group);
        root.add(group);
      }
      group.userData = { id: dot.id, role: dot.role, state: dot.state };
      // People use metre-sized glyphs even when the proposed counter root is scaled.
      group.scale.setScalar(1 / placement.scale);
      group.position.set(
        dot.x / placement.scale,
        0.4 / placement.scale,
        dot.z / placement.scale,
      );
      group.children[1].visible =
        dot.role === "employee" || dot.id === replay.selected;
      group.children[1].scale.setScalar(dot.id === replay.selected ? 1.35 : 1);
    }
    while (this.counters.length > replay.stationCount)
      root.remove(this.counters.pop()!);
    while (this.counters.length < replay.stationCount) {
      const counter = new THREE.Mesh(this.geometries[2], this.materials[3]);
      counter.userData.role = "proposed-counter";
      root.add(counter);
      this.counters.push(counter);
    }
    this.counters.forEach((counter, index) =>
      counter.position.set(
        layout.stations[index].x / placement.scale,
        0.04,
        layout.stations[index].z / placement.scale,
      ),
    );
  }
  onEvent(type: string, data?: unknown) {
    if (
      type !== "INTERACTION.CLICK" ||
      typeof data !== "object" ||
      data === null
    )
      return;
    // SDK versions may supply the hit object directly or as the first intersection.
    const hit = data as {
      object?: Three.Object3D;
      intersections?: { object?: Three.Object3D }[];
    };
    let object = hit.object ?? hit.intersections?.[0]?.object;
    while (object) {
      if (typeof object.userData?.id === "string") {
        this.select(object.userData.id);
        return;
      }
      object = object.parent ?? undefined;
    }
  }
  onDestroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.outputs.objectRoot?.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.dots.clear();
    this.counters = [];
    this.outputs.objectRoot = null;
    this.outputs.collider = null;
  }
}

let registration = 0;
/**
 * Builds a fresh scene object every call. A stopped Matterport scene object
 * cannot be started again, so reconnects and retries must come through here
 * rather than reuse an earlier session's object.
 */
export async function attachReplayScene(
  sdk: MatterportSceneSdk,
  placement: ScanPlacement,
  replay: ScanReplay,
  select: (id: string) => void,
  signal?: AbortSignal,
) {
  const cancelled = () => new Error("Scene initialization cancelled");
  if (signal?.aborted) throw cancelled();
  const name = `bizbox.replay-dots-${++registration}`;
  let didInitialize = false;
  let resolveInitialized: () => void = () => {};
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });
  const registered = await sdk.Scene.register(
    name,
    () =>
      new ReplayComponent(replay, placement, select, () => {
        didInitialize = true;
        resolveInitialized();
      }),
  );
  const unregister = () => {
    const disposable = registered as { dispose?(): void } | undefined;
    if (typeof disposable?.dispose === "function") disposable.dispose();
  };
  let object: SceneObject | undefined;
  try {
    if (signal?.aborted) throw cancelled();
    [object] = await sdk.Scene.createObjects(1);
    if (!object) throw new Error("Scene initialization failed");
  } catch (error) {
    // createObjects may still resolve after an abort; never leave it running.
    unregister();
    throw error;
  }
  const created = object;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    created.stop();
    unregister();
  };
  let component: ReplayComponent;
  try {
    component = created.addNode().addComponent(name, { replay, placement });
    if (signal?.aborted) throw cancelled();
    await created.start();
    if (!didInitialize) {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(cancelled());
        const timer = setTimeout(
          () => finish(new Error("Scene initialization timed out")),
          15000,
        );
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        else void initialized.then(() => finish());
      });
    }
    if (signal?.aborted) throw cancelled();
  } catch (error) {
    stop();
    throw error;
  }
  return {
    update(next: ScanReplay, nextPlacement = placement) {
      if (stopped) return;
      component.inputs.replay = next;
      component.inputs.placement = nextPlacement;
    },
    dispose: stop,
  };
}
