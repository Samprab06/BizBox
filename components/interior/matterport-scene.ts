import type * as Three from "three";
import type { interiorFrame } from "../simulator/interior-state";
import { stationPosition } from "../simulator/interior-state";

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
    register(name: string, factory: () => ReplayComponent): Promise<unknown>;
    createObjects(count: number): Promise<SceneObject[]>;
  };
};

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
    this.geometries = [
      new THREE.SphereGeometry(0.18, 12, 8),
      new THREE.TorusGeometry(0.26, 0.035, 5, 16),
      new THREE.BoxGeometry(2.1, 0.06, 0.8),
    ];
    this.materials = [
      new THREE.MeshBasicMaterial({ color: "#60a5fa", depthTest: true }),
      new THREE.MeshBasicMaterial({ color: "#c084fc", depthTest: true }),
      new THREE.MeshBasicMaterial({ color: "#f8fafc", depthTest: true }),
      new THREE.MeshBasicMaterial({
        color: "#5eead4",
        transparent: true,
        opacity: 0.4,
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
    const desired = [
      ...replay.frame.customers.map((dot) => ({ ...dot, role: "customer" })),
      ...replay.frame.employees.map((dot) => ({
        ...dot,
        state: "staffing",
        role: "employee",
      })),
    ];
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
        group.add(outline);
        this.dots.set(dot.id, group);
        root.add(group);
      }
      group.userData = { id: dot.id, role: dot.role, state: dot.state };
      group.position.set(dot.x, 0.25, dot.z);
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
        stationPosition(index, replay.stationCount),
        0.04,
        -1.55,
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
    this.dots.clear();
    this.counters = [];
    this.outputs.objectRoot = null;
    this.outputs.collider = null;
  }
}

let registration = 0;
export async function attachReplayScene(
  sdk: MatterportSceneSdk,
  placement: ScanPlacement,
  replay: ScanReplay,
  select: (id: string) => void,
  signal?: AbortSignal,
) {
  const name = `bizbox.replay-dots-${++registration}`;
  let didInitialize = false;
  let resolveInitialized: () => void = () => {};
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });
  await sdk.Scene.register(
    name,
    () =>
      new ReplayComponent(replay, placement, select, () => {
        didInitialize = true;
        resolveInitialized();
      }),
  );
  const [object] = await sdk.Scene.createObjects(1);
  if (!object) throw new Error("Scene initialization failed");
  let component: ReplayComponent;
  try {
    component = object.addNode().addComponent(name, { replay, placement });
    if (signal?.aborted) throw new Error("Scene initialization cancelled");
    await object.start();
    if (!didInitialize) {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new Error("Scene initialization cancelled"));
        const timer = setTimeout(
          () => finish(new Error("Scene initialization timed out")),
          15000,
        );
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        else void initialized.then(() => finish());
      });
    }
  } catch (error) {
    object.stop();
    throw error;
  }
  let disposed = false;
  return {
    update(next: ScanReplay, nextPlacement = placement) {
      if (disposed) return;
      component.inputs.replay = next;
      component.inputs.placement = nextPlacement;
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        object.stop();
      }
    },
  };
}
