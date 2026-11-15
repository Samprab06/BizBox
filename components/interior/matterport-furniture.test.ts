import { it, expect, vi } from "vitest";
import { buildInteriorProposal } from "@/lib/interior/proposal-state";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import {
  attachFurnitureScene,
  type FurnitureSceneSdk,
} from "./matterport-furniture";
const proposal = () =>
  buildInteriorProposal(
    applySpatialCommand(
      createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" }),
      {
        type: "add",
        id: "table",
        catalogId: FURNITURE_CATALOG[0]!.id,
        x: 2,
        z: 3,
        rotation: 90,
      },
    ),
    {
      modelId: "qfmMbTLt4Bo",
      origin: { x: 1, y: 0, z: 1 },
      rotationY: 0,
      roomAnchor: { x: 0, z: 0 },
      source: "illustrative-reference",
    },
  );
function fake(state = "Loaded") {
  const outputs = { loadingState: state, objectRoot: { name: "loaded-model" } };
  const nodes: { name: string; inputs: Record<string, unknown> }[] = [];
  const positions: ReturnType<typeof vi.fn>[] = [];
  const stop = vi.fn();
  const start = vi.fn();
  const sdk = {
    Scene: {
      createObjects: vi.fn(async () => [
        {
          addNode: () => {
            const set = vi.fn();
            positions.push(set);
            return {
              position: { set },
              addComponent: (name: string, inputs: Record<string, unknown>) => {
                nodes.push({ name, inputs });
                return { inputs, outputs };
              },
            };
          },
          start,
          stop,
        },
      ]),
    },
  } as unknown as FurnitureSceneSdk;
  return { sdk, nodes, stop, start, outputs, positions };
}
it("uses SDK-native loader and physical meter scale; clears/stops objects", async () => {
  const f = fake(),
    p = proposal(),
    layer = await attachFurnitureScene(f.sdk, p);
  expect(f.nodes[0]!.name).toBe("mp.gltfLoader");
  expect(f.nodes[0]!.inputs.url).toContain("/furniture/");
  expect(f.nodes[0]!.inputs.visible).toBe(true);
  expect(f.nodes[0]!.inputs.colliderEnabled).toBe(false);
  expect(f.nodes[0]!.inputs.localScale).toEqual({ x: 1, y: 1, z: 1 });
  await layer.update({ ...p, revision: 2, items: [] });
  expect(f.stop).toHaveBeenCalledTimes(1);
  layer.dispose();
  layer.dispose();
  expect(f.stop).toHaveBeenCalledTimes(1);
});
it("disposes aborted or failed scene startup without leaving running objects", async () => {
  const f = fake();
  f.start.mockRejectedValueOnce(new Error("failed"));
  await expect(attachFurnitureScene(f.sdk, proposal())).rejects.toThrow(
    "failed",
  );
  expect(f.stop).toHaveBeenCalledTimes(1);
  const c = new AbortController();
  c.abort();
  await expect(
    attachFurnitureScene(fake().sdk, proposal(), c.signal),
  ).rejects.toThrow("cancelled");
});
it("grounds model bounds using rotated offsets and retains the previous scene on invalid updates", async () => {
  const f = fake(),
    p = proposal(),
    layer = await attachFurnitureScene(f.sdk, p),
    item = p.items[0]!;
  const [ox, oy, oz] = item.modelOffsetM;
  expect(f.positions[0]).toHaveBeenCalledWith(
    item.position.x,
    item.position.y,
    item.position.z,
  );
  expect(f.nodes[0]!.inputs.localPosition).toEqual({ x: ox, y: oy, z: oz });
  expect(f.nodes[0]!.inputs.localRotation).toEqual({
    x: 0,
    y: (item.rotationY * 180) / Math.PI,
    z: 0,
  });
  await expect(layer.update({ ...p, siteId: "another-site" })).rejects.toThrow(
    "scope",
  );
  expect(f.stop).not.toHaveBeenCalled();
  layer.dispose();
  expect(f.stop).toHaveBeenCalledTimes(1);
});
it("cleans objects created after cancellation while creation is pending", async () => {
  const f = fake();
  let resolve: (
    v: Awaited<ReturnType<FurnitureSceneSdk["Scene"]["createObjects"]>>,
  ) => void = () => {};
  const original = await f.sdk.Scene.createObjects(1);
  vi.spyOn(f.sdk.Scene, "createObjects").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const controller = new AbortController(),
    pending = attachFurnitureScene(f.sdk, proposal(), controller.signal);
  controller.abort();
  resolve(original);
  await expect(pending).rejects.toThrow("cancelled");
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.start).not.toHaveBeenCalled();
});
it("adds one native ambient light for all furniture and clears its owning object", async () => {
  const f = fake(),
    p = proposal();
  p.items.push({
    ...p.items[0]!,
    id: "another-table",
    position: { x: 5, y: 0, z: 5 },
  });
  const original = await f.sdk.Scene.createObjects(1);
  vi.spyOn(f.sdk.Scene, "createObjects").mockImplementation(async (count) => {
    return Array.from({ length: count }, () => ({ ...original[0]! }));
  });
  const layer = await attachFurnitureScene(f.sdk, p);
  const lights = f.nodes.filter((n) => n.name === "mp.ambientLight");
  expect(lights).toHaveLength(1);
  expect(lights[0]!.inputs.enabled).toBe(true);
  expect(lights[0]!.inputs.intensity).toBeGreaterThan(0);
  await layer.update({ ...p, items: [] });
  expect(f.stop).toHaveBeenCalledTimes(2);
  layer.dispose();
  expect(f.stop).toHaveBeenCalledTimes(2);
});

it("waits for genuine Loaded and surfaces Error instead of claiming scene-ready", async () => {
  const f = fake("Error");
  await expect(attachFurnitureScene(f.sdk, proposal())).rejects.toThrow(
    "Furniture model failed to load",
  );
  expect(f.stop).toHaveBeenCalledTimes(1);
  const loaded = await attachFurnitureScene(fake().sdk, proposal());
  expect(loaded.status).toBe("loaded");
  loaded.dispose();
});
it("waits through Loading and cancels a pending model load", async () => {
  vi.useFakeTimers();
  try {
    const f = fake("Loading"),
      controller = new AbortController();
    const promise = attachFurnitureScene(f.sdk, proposal(), controller.signal);
    const rejection = expect(promise).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejection;
    expect(f.stop).not.toHaveBeenCalled();
    f.outputs.loadingState = "Loaded";
    await vi.advanceTimersByTimeAsync(100);
    expect(f.stop).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
it("times out unavailable loading states and reports native roots only after Loaded", async () => {
  vi.useFakeTimers();
  try {
    const f = fake("Loading"),
      pending = attachFurnitureScene(f.sdk, proposal());
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15100);
    await rejection;
    expect(f.stop).not.toHaveBeenCalled();
    f.outputs.loadingState = "Error";
    await vi.advanceTimersByTimeAsync(100);
    expect(f.stop).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
  const f = fake(),
    layer = await attachFurnitureScene(f.sdk, proposal());
  expect(layer.inspectModels()[0]!.objectRoot).toEqual(f.outputs.objectRoot);
  layer.dispose();
  expect(layer.inspectModels()).toEqual([]);
});
