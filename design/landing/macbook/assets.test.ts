import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Object3D, Vector3 } from "three";

type Gltf = {
  scenes: { nodes: number[] }[];
  nodes: {
    name: string;
    children?: number[];
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    extras?: Record<string, unknown>;
  }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices: number }[];
  }[];
  accessors: {
    count: number;
    componentType: number;
    type: string;
    bufferView: number;
    byteOffset?: number;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }[];
  buffers: { byteLength: number; uri?: string }[];
  cameras?: unknown[];
};
function load(name: string) {
  const file = readFileSync(
    fileURLToPath(
      new URL(
        `../../../public/landing-assets/macbook/${name}`,
        import.meta.url,
      ),
    ),
  );
  expect(file.toString("ascii", 0, 4)).toBe("glTF");
  expect(file.readUInt32LE(4)).toBe(2);
  expect(file.readUInt32LE(8)).toBe(file.length);
  const size = file.readUInt32LE(12);
  const json = JSON.parse(file.toString("utf8", 20, 20 + size)) as Gltf;
  const binary = file.subarray(28 + size);
  const nodes = json.nodes.map((n) => {
    const object = new Object3D();
    object.name = n.name;
    if (n.matrix) object.applyMatrix4(new Matrix4().fromArray(n.matrix));
    else {
      if (n.translation) object.position.fromArray(n.translation);
      if (n.rotation) object.quaternion.fromArray(n.rotation);
      if (n.scale) object.scale.fromArray(n.scale);
    }
    return object;
  });
  json.nodes.forEach((n, i) =>
    n.children?.forEach((child) => nodes[i].add(nodes[child])),
  );
  const root = new Object3D();
  json.scenes[0].nodes.forEach((i) => root.add(nodes[i]));
  root.updateMatrixWorld(true);
  const triangles = json.meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (n, p) => n + json.accessors[p.indices].count / 3,
        0,
      ),
    0,
  );
  return { json, binary, nodes, root, triangles };
}

describe("MacBook asset handoff", () => {
  for (const file of ["macbook.glb", "macbook-mobile.glb"]) {
    it(`${file} contains only the intended laptop scene with embedded resources`, () => {
      const { json, binary } = load(file);
      expect(json.scenes).toHaveLength(1);
      expect(json.scenes[0].nodes).toHaveLength(1);
      expect(json.nodes[json.scenes[0].nodes[0]].name).toBe(
        "HAC115_LaptopRoot",
      );
      expect(json.nodes[json.scenes[0].nodes[0]].extras?.license).toBe(
        "https://creativecommons.org/licenses/by/4.0/",
      );
      expect(json.cameras ?? []).toHaveLength(0);
      expect(json.buffers).toHaveLength(1);
      expect(json.buffers[0].uri).toBeUndefined();
      for (const view of json.bufferViews) {
        expect(view.buffer).toBe(0);
        expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(
          binary.length,
        );
      }
      const names = json.nodes.map((n) => n.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names).not.toContain("CafeRoot");
      expect(names).not.toContain("V3__LaptopRoot");
    });
  }

  it("provides lighter mobile geometry without dropping the screen", () => {
    const desktop = load("macbook.glb");
    const mobile = load("macbook-mobile.glb");
    expect(desktop.triangles).toBeLessThan(120_000);
    expect(mobile.triangles).toBeGreaterThan(35_000);
    expect(mobile.triangles).toBeLessThan(desktop.triangles * 0.6);
    expect(mobile.root.getObjectByName("HAC115_Screen")).toBeDefined();
  });

  it("keeps the body stationary while screen and anchors follow the hinge", () => {
    const { root } = load("macbook.glb");
    const hinge = root.getObjectByName("HAC115_LidPivot")!;
    const base = root.getObjectByName("HAC115_LaptopBase")!;
    const corner = root.getObjectByName("HAC115_ScreenTopLeft")!;
    expect(root.getObjectByName("HAC115_Screen")!.parent).toBe(hinge);
    expect(corner.parent).toBe(hinge);
    const original = corner.getWorldPosition(new Vector3());
    const originalBase = base.matrixWorld.clone();
    hinge.rotation.x = 0.5;
    root.updateMatrixWorld(true);
    expect(
      corner.getWorldPosition(new Vector3()).distanceTo(original),
    ).toBeGreaterThan(0.05);
    expect(base.matrixWorld.equals(originalBase)).toBe(true);
  });

  it("exports physical laptop dimensions and an upright, undistorted screen UV", () => {
    const { root, json, nodes, binary } = load("macbook.glb");
    const bounds = new Box3();
    json.nodes.forEach((node, index) => {
      if (node.mesh === undefined) return;
      for (const primitive of json.meshes[node.mesh].primitives) {
        const position = json.accessors[primitive.attributes.POSITION];
        bounds.union(
          new Box3(
            new Vector3().fromArray(position.min!),
            new Vector3().fromArray(position.max!),
          ).applyMatrix4(nodes[index].matrixWorld),
        );
      }
    });
    expect(bounds.getSize(new Vector3()).x).toBeCloseTo(0.3557, 4);
    const tl = root
      .getObjectByName("HAC115_ScreenTopLeft")!
      .getWorldPosition(new Vector3());
    const tr = root
      .getObjectByName("HAC115_ScreenTopRight")!
      .getWorldPosition(new Vector3());
    const bl = root
      .getObjectByName("HAC115_ScreenBottomLeft")!
      .getWorldPosition(new Vector3());
    const right = tr.clone().sub(tl).normalize();
    const up = tl.clone().sub(bl).normalize();
    const width = tl.distanceTo(tr),
      height = tl.distanceTo(bl);
    expect(width / height).toBeCloseTo(1600 / 1036, 2);
    const index = json.nodes.findIndex((n) => n.name === "HAC115_Screen");
    const primitive = json.meshes[json.nodes[index].mesh!].primitives[0];
    function read(accessorIndex: number, row: number, column: number) {
      const accessor = json.accessors[accessorIndex];
      expect(accessor.componentType).toBe(5126);
      const view = json.bufferViews[accessor.bufferView];
      const columns = accessor.type === "VEC3" ? 3 : 2;
      return binary.readFloatLE(
        (view.byteOffset ?? 0) +
          (accessor.byteOffset ?? 0) +
          row * (view.byteStride ?? columns * 4) +
          column * 4,
      );
    }
    const positions = primitive.attributes.POSITION,
      uv = primitive.attributes.TEXCOORD_0;
    for (let i = 0; i < json.accessors[positions].count; i++) {
      const point = new Vector3(
        read(positions, i, 0),
        read(positions, i, 1),
        read(positions, i, 2),
      )
        .applyMatrix4(nodes[index].matrixWorld)
        .sub(bl);
      expect(read(uv, i, 0)).toBeCloseTo(point.dot(right) / width, 4);
      // glTF texture V is top-down; Blender export converts from authored UVs.
      expect(read(uv, i, 1)).toBeCloseTo(1 - point.dot(up) / height, 4);
    }
  });
});
