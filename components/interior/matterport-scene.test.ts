import { expect, it, vi } from "vitest";
import * as Three from "three";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";
import {
  attachReplayScene,
  type MatterportSceneSdk,
  type ReplayComponent,
  type ScanPlacement,
} from "./matterport-scene";

const placement: ScanPlacement = {
  origin: { x: 4, y: -1, z: 7 },
  rotationY: Math.PI / 2,
  scale: 0.5,
};
function fakeSdk() {
  let factory: () => ReplayComponent;
  let component: ReplayComponent;
  const scene = new Three.Scene();
  const object = {
    addNode: () => ({
      addComponent: (_name: string, inputs: ReplayComponent["inputs"]) => {
        component = factory();
        // The live SDK reserves these outputs and injects them before onInit.
        if (
          Object.hasOwn(component.outputs, "objectRoot") ||
          Object.hasOwn(component.outputs, "collider")
        ) {
          throw new Error(
            "Reserved SDK outputs must not be declared by components",
          );
        }
        Object.assign(component.outputs, { objectRoot: null, collider: null });
        component.context = { three: Three };
        Object.assign(component.inputs, inputs);
        component.inputs = new Proxy(component.inputs, {
          set(target, key, value) {
            Reflect.set(target, key, value);
            component.onInputsUpdated();
            return true;
          },
        });
        return component;
      },
    }),
    start: vi.fn(() => {
      component.onInit();
      scene.add(component.outputs.objectRoot!);
    }),
    stop: vi.fn(() => component.onDestroy()),
  };
  const sdk: MatterportSceneSdk = {
    Scene: {
      register: async (_name, fn) => {
        factory = fn;
      },
      createObjects: async () => [object],
    },
  };
  return {
    sdk,
    object,
    scene,
    get component() {
      return component;
    },
  };
}

it("keeps markers readable at scan scale with curved shading and floor contact cues", async () => {
  const fake = fakeSdk();
  const { run } = makeDemo()[1];
  const session = await attachReplayScene(
    fake.sdk,
    placement,
    {
      frame: interiorFrame(run, 504, 2),
      selected: "",
      stationCount: 2,
    },
    () => {},
  );
  const root = fake.component.outputs.objectRoot!;
  root.updateMatrixWorld(true);
  const person = root.children.find(
    (child) => child.userData.role === "customer",
  )!;
  const sphere = person.children[0] as Three.Mesh<
    Three.SphereGeometry,
    Three.MeshMatcapMaterial
  >;
  sphere.geometry.computeBoundingSphere();
  const worldRadius =
    sphere.geometry.boundingSphere!.radius *
    sphere.getWorldScale(new Three.Vector3()).x;
  expect(worldRadius).toBeGreaterThanOrEqual(0.15);
  expect(sphere.material.matcap).toBeDefined();
  const texture = sphere.material.matcap as Three.DataTexture;
  const pixels = texture.image.data as Uint8Array;
  const brightness = Array.from(pixels).filter((_, index) => index % 4 === 0);
  expect(Math.max(...brightness) - Math.min(...brightness)).toBeGreaterThan(
    100,
  );
  const shadow = person.children.find(
    (child) => child.userData.role === "contact-shadow",
  ) as Three.Mesh;
  expect(shadow).toBeDefined();
  expect(shadow.position.y).toBeLessThan(0);
  expect((shadow.material as Three.Material).depthTest).toBe(true);
  const disposed = vi.fn();
  texture.addEventListener("dispose", disposed);
  session.dispose();
  expect(disposed).toHaveBeenCalledOnce();
});

it("projects actual customer/employee dots and proposed counters through the iframe Three scene", async () => {
  const fake = fakeSdk();
  const { run, staffing } = makeDemo()[1];
  const replay = {
    frame: interiorFrame(run, 504, staffing?.headcount),
    selected: "employee-2",
    stationCount: 2,
  };
  const session = await attachReplayScene(
    fake.sdk,
    placement,
    replay,
    () => {},
  );
  const root = fake.component.outputs.objectRoot!;
  expect(fake.object.start).toHaveBeenCalledOnce();
  expect(root.position.toArray()).toEqual([4, -1, 7]);
  expect(root.rotation.y).toBe(Math.PI / 2);
  expect(root.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
  const employees = root.children.filter(
    (child) => child.userData.role === "employee",
  );
  const customers = root.children.filter(
    (child) => child.userData.role === "customer",
  );
  expect(employees).toHaveLength(2);
  expect(customers).toHaveLength(replay.frame.customers.length);
  expect(
    root.children.filter((child) => child.userData.role === "proposed-counter"),
  ).toHaveLength(2);
  const employee = employees[1] as Three.Group;
  expect(employee.position.x * placement.scale).toBe(1.1);
  const dot = employee.children[0] as Three.Mesh<
    Three.SphereGeometry,
    Three.MeshMatcapMaterial
  >;
  expect(dot.material.color.getHexString()).toBe("c084fc");
  expect(dot.material.depthTest).toBe(true);
  expect(dot.geometry.type).toBe("SphereGeometry");
  expect(employee.children[1].visible).toBe(true);
  expect(
    (
      customers[0].children[0] as Three.Mesh<
        Three.SphereGeometry,
        Three.MeshMatcapMaterial
      >
    ).material.color.getHexString(),
  ).toBe("60a5fa");
  session.dispose();
});

it("updates one/two plans and backward seeks without retained meshes or independent time", async () => {
  const fake = fakeSdk();
  const [one, two] = makeDemo();
  const oneInput = {
    frame: interiorFrame(one.run, 504, 1),
    selected: "",
    stationCount: 1,
  };
  const session = await attachReplayScene(
    fake.sdk,
    placement,
    oneInput,
    () => {},
  );
  session.update({
    frame: interiorFrame(two.run, 540, 2),
    selected: "",
    stationCount: 2,
  });
  expect(
    fake.component.outputs.objectRoot!.children.filter(
      (child) => child.userData.role === "employee",
    ),
  ).toHaveLength(2);
  session.update(oneInput);
  const root = fake.component.outputs.objectRoot!;
  expect(
    root.children.filter((child) => child.userData.role === "employee"),
  ).toHaveLength(1);
  expect(
    root.children.filter((child) => child.userData.role === "customer"),
  ).toHaveLength(oneInput.frame.customers.length);
  expect(
    root.children.filter((child) => child.userData.role === "proposed-counter"),
  ).toHaveLength(1);
  session.update({
    frame: interiorFrame(one.run, 480, 1),
    selected: "",
    stationCount: 1,
  });
  expect(
    root.children.filter((child) => child.userData.state === "waiting"),
  ).toHaveLength(0);
  session.dispose();
});

it("shares geometry, disposes resources once, and removes the provider scene on teardown", async () => {
  const fake = fakeSdk();
  const { run } = makeDemo()[1];
  const session = await attachReplayScene(
    fake.sdk,
    placement,
    { frame: interiorFrame(run, 504, 2), selected: "", stationCount: 2 },
    () => {},
  );
  const root = fake.component.outputs.objectRoot!;
  const dots = root.children.filter(
    (child) =>
      child.userData.role === "employee" || child.userData.role === "customer",
  );
  const geometry = (dots[0].children[0] as Three.Mesh).geometry;
  expect((dots[1].children[0] as Three.Mesh).geometry).toBe(geometry);
  const disposed = vi.fn();
  geometry.addEventListener("dispose", disposed);
  session.dispose();
  session.dispose();
  expect(fake.object.stop).toHaveBeenCalledOnce();
  expect(disposed).toHaveBeenCalledOnce();
  expect(root.parent).toBeNull();
});

it("does not report a running overlay until the SDK initialized the component", async () => {
  const fake = fakeSdk();
  fake.object.start.mockImplementation(() => {});
  const { run } = makeDemo()[0];
  let ready = false;
  const result = attachReplayScene(
    fake.sdk,
    placement,
    { frame: interiorFrame(run, 504, 1), selected: "", stationCount: 1 },
    () => {},
  ).then((session) => {
    ready = true;
    return session;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ready).toBe(false);
  fake.component.onInit();
  const session = await result;
  expect(ready).toBe(true);
  session.dispose();
});

it("cancels a component that never initializes without leaving its SDK object", async () => {
  const fake = fakeSdk();
  fake.object.start.mockImplementation(() => {});
  const { run } = makeDemo()[0];
  const controller = new AbortController();
  const result = attachReplayScene(
    fake.sdk,
    placement,
    { frame: interiorFrame(run, 504, 1), selected: "", stationCount: 1 },
    () => {},
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(fake.object.stop).toHaveBeenCalledOnce();
});

it("renders 0.8m spheres resting on the floor independently of placement scale", async () => {
  for (const scale of [0.5, 1]) {
    const fake = fakeSdk();
    const { run } = makeDemo()[1];
    const currentPlacement = { ...placement, scale };
    const session = await attachReplayScene(
      fake.sdk,
      currentPlacement,
      { frame: interiorFrame(run, 504, 2), selected: "", stationCount: 2 },
      () => {},
    );
    const root = fake.component.outputs.objectRoot!;
    root.updateMatrixWorld(true);
    for (const person of root.children.filter(
      (child) =>
        child.userData.role === "customer" ||
        child.userData.role === "employee",
    )) {
      const sphere = person.children[0] as Three.Mesh<Three.SphereGeometry>;
      sphere.geometry.computeBoundingSphere();
      const radius =
        sphere.geometry.boundingSphere!.radius *
        sphere.getWorldScale(new Three.Vector3()).x;
      expect(radius * 2).toBeCloseTo(0.8, 6);
      expect(
        sphere.getWorldPosition(new Three.Vector3()).y - radius,
      ).toBeCloseTo(currentPlacement.origin.y, 6);
    }
    const standing = root.children.filter(
      (child) =>
        child.userData.role === "employee" ||
        child.userData.state === "waiting" ||
        child.userData.state === "serving",
    );
    standing.forEach((person, index) => {
      const position = person.getWorldPosition(new Three.Vector3());
      for (const other of standing.slice(index + 1))
        expect(
          position.distanceTo(other.getWorldPosition(new Three.Vector3())),
        ).toBeGreaterThanOrEqual(2 - 1e-6);
    });
    expect(root.scale.x).toBe(scale);
    const counter = root.children.find(
      (child) => child.userData.role === "proposed-counter",
    )!;
    expect(counter.getWorldScale(new Three.Vector3()).x).toBe(scale);
    session.dispose();
  }
});
