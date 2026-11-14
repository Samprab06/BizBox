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
  expect(employee.position.x).toBe(replay.frame.employees[1].x);
  const dot = employee.children[0] as Three.Mesh<
    Three.SphereGeometry,
    Three.MeshBasicMaterial
  >;
  expect(dot.material.color.getHexString()).toBe("c084fc");
  expect(dot.material.depthTest).toBe(true);
  expect(dot.geometry.type).toBe("SphereGeometry");
  expect(employee.children[1].visible).toBe(true);
  expect(
    (
      customers[0].children[0] as Three.Mesh<
        Three.SphereGeometry,
        Three.MeshBasicMaterial
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
