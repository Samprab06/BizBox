import type {
  InteriorProposal,
  InteriorProposalItem,
} from "@/lib/interior/proposal-state";
import { furnitureById } from "@/lib/furniture/catalog";
type LoaderInputs = {
  url: string;
  visible: true;
  colliderEnabled: false;
  localPosition: { x: number; y: number; z: number };
  localRotation: { x: number; y: number; z: number };
  localScale: { x: number; y: number; z: number };
};
type NativeLoader = {
  outputs: { loadingState?: string; objectRoot?: unknown };
};
function waitForLoaded(
  loader: NativeLoader,
  signal: AbortSignal | undefined,
  current: () => boolean,
) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(new Error("Furniture scene initialization cancelled"));
    const poll = () => {
      if (signal?.aborted || !current()) return abort();
      if (loader.outputs.loadingState === "Error")
        return finish(new Error("Furniture model failed to load"));
      if (loader.outputs.loadingState === "Loaded") return finish();
      if (Date.now() >= deadline)
        return finish(new Error("Furniture model loading timed out"));
      timer = setTimeout(poll, 100);
    };
    signal?.addEventListener("abort", abort, { once: true });
    poll();
  });
}
type FurnitureObject = {
  addNode(): {
    position: { set(x: number, y: number, z: number): unknown };
    addComponent(name: "mp.gltfLoader", inputs: LoaderInputs): NativeLoader;
    addComponent(
      name: "mp.ambientLight",
      inputs: {
        enabled: boolean;
        color: { r: number; g: number; b: number };
        intensity: number;
      },
    ): unknown;
  };
  start(): void | Promise<void>;
  stop(): void;
};
export type FurnitureSceneSdk = {
  Scene: { createObjects(count: number): Promise<FurnitureObject[]> };
};
function loaderInputs(item: InteriorProposalItem): LoaderInputs {
  const catalog = furnitureById(item.catalogId);
  if (!catalog || catalog.assetUrl !== item.assetUrl)
    throw new Error("Unapproved furniture model URL");
  const [ox, oy, oz] = item.modelOffsetM;
  return {
    visible: true,
    colliderEnabled: false,
    url: new URL(
      item.assetUrl,
      typeof location === "undefined" ? "http://localhost" : location.origin,
    ).href,
    localPosition: {
      x: ox,
      y: oy,
      z: oz,
    },
    localRotation: { x: 0, y: (item.rotationY * 180) / Math.PI, z: 0 },
    localScale: { x: 1, y: 1, z: 1 },
  };
}
/** Uses Showcase's own GLTF loader/Three context; no application Three constructors. */
export async function attachFurnitureScene(
  sdk: FurnitureSceneSdk,
  initial: InteriorProposal,
  signal?: AbortSignal,
) {
  let appliedSignature: string | undefined;
  let activeModels: { id: string; loader: NativeLoader }[] = [];
  let disposed = false,
    revision = 0,
    active: FurnitureObject[] = [];
  const cancelled = () => new Error("Furniture scene initialization cancelled");
  const nativeLoaders = new Map<FurnitureObject, NativeLoader>();
  const retired = new WeakSet<FurnitureObject>();
  const stop = (objects: FurnitureObject[]) => {
    for (const object of objects) {
      if (retired.has(object)) continue;
      retired.add(object);
      const finish = () => {
        const loader = nativeLoaders.get(object);
        // The pinned provider awaits its asset fetch then dereferences pivot.
        // Stopping while Loading nulls pivot and causes a native null.add error.
        if (loader?.outputs.loadingState === "Loading") {
          setTimeout(finish, 100);
          return;
        }
        nativeLoaders.delete(object);
        try {
          object.stop();
        } catch {
          /* Provider scene may already have navigated away. */
        }
      };
      finish();
    }
  };
  const abort = () => {
    if (disposed) return;
    disposed = true;
    revision++;
    stop(active);
    active = [];
    activeModels = [];
  };
  signal?.addEventListener("abort", abort, { once: true });
  let latestRequest = 0;
  const apply = async (proposal: InteriorProposal, version: number) => {
    if (disposed || signal?.aborted) throw cancelled();
    if (
      proposal.calibration.modelId !== initial.calibration.modelId ||
      proposal.siteId !== initial.siteId ||
      proposal.projectId !== initial.projectId ||
      proposal.draftId !== initial.draftId
    )
      throw new Error("Furniture proposal scope mismatch");
    const inputs = proposal.items.map(loaderInputs);
    const signature = JSON.stringify(inputs);
    const request = ++revision;
    if (signature === appliedSignature) return;
    const objects: FurnitureObject[] = [];
    const loaders: NativeLoader[] = [];
    let failed = false;
    try {
      if (inputs.length) {
        const created = await sdk.Scene.createObjects(inputs.length);
        objects.push(...created);
        if (created.length !== inputs.length)
          throw new Error("Furniture scene creation incomplete");
        for (let i = 0; i < created.length; i++) {
          if (disposed || signal?.aborted || request !== revision)
            throw cancelled();
          const node = created[i]!.addNode();
          const item = proposal.items[i]!;
          node.position.set(item.position.x, item.position.y, item.position.z);
          const loader = node.addComponent("mp.gltfLoader", inputs[i]!);
          loaders.push(loader);
          nativeLoaders.set(created[i]!, loader);
          if (i === 0)
            created[i]!.addNode().addComponent("mp.ambientLight", {
              enabled: true,
              color: { r: 1, g: 1, b: 1 },
              intensity: 1,
            });
          await created[i]!.start();
        }
      }
      await Promise.all(
        loaders.map((loader) =>
          waitForLoaded(
            loader,
            signal,
            () => !failed && !disposed && request === revision,
          ),
        ),
      );
      if (disposed || signal?.aborted || request !== revision)
        throw cancelled();
      if (version !== latestRequest) {
        stop(objects);
        return;
      }
      const previous = active;
      active = objects;
      activeModels = loaders.map((loader, i) => ({
        id: proposal.items[i]!.id,
        loader,
      }));
      appliedSignature = signature;
      stop(previous);
    } catch (error) {
      failed = true;
      stop(objects);
      throw error;
    }
  };
  try {
    await apply(initial, 0);
  } catch (error) {
    abort();
    signal?.removeEventListener("abort", abort);
    throw error;
  }
  let pending: Promise<void> = Promise.resolve();
  const update = (proposal: InteriorProposal) => {
    const version = ++latestRequest;
    const work = pending
      .catch(() => {})
      .then(() =>
        version === latestRequest ? apply(proposal, version) : undefined,
      );
    pending = work;
    return work;
  };
  return {
    /** Every native loader reported Loaded; placement visibility still needs visual verification. */ status:
      "loaded" as const,
    update,
    inspectModels() {
      return activeModels.map(({ id, loader }) => ({
        id,
        loadingState: loader.outputs.loadingState,
        objectRoot: loader.outputs.objectRoot,
      }));
    },
    dispose() {
      abort();
      signal?.removeEventListener("abort", abort);
    },
  };
}
