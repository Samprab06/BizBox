import { describe, expect, it } from "vitest";
import {
  gltfModelBounds,
  safeDependencyPath,
  verifyDownload,
  validateMetadataDimensions,
} from "./prepare-furniture-catalog";

describe("furniture preparation", () => {
  const model = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [2, 1, -3] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ type: "VEC3", min: [-0.5, -0.1, -1], max: [0.5, 0.9, 1] }],
  };
  it("uses glTF scene bounds in meters and Y-up, including node transforms", () => {
    const bounds = gltfModelBounds(model);
    expect(bounds.widthM).toBeCloseTo(1);
    expect(bounds.depthM).toBeCloseTo(2);
    expect(bounds.heightM).toBeCloseTo(1);
    expect(bounds.modelOffsetM).toEqual([-2, -0.9, 3]);
  });
  it("records a baked footprint-axis swap without rescaling the glTF", () => {
    expect(
      validateMetadataDimensions([1077.7609, 371.5097, 1556.1838], {
        widthM: 0.37150964,
        depthM: 1.07776093,
        heightM: 1.55618382,
      }),
    ).toBe("swapped-in-gltf");
    expect(() =>
      validateMetadataDimensions([1000, 500, 900], {
        widthM: 1,
        depthM: 0.5,
        heightM: 1.8,
      }),
    ).toThrow();
  });
  it("fails unknown bounds instead of inventing dimensions", () => {
    expect(() => gltfModelBounds({ ...model, accessors: [] })).toThrow();
  });
  it("rejects external, traversing and encoded asset paths", () => {
    for (const uri of [
      "../secret",
      "https://evil.test/a",
      "/absolute",
      "%2e%2e/a",
      "textures\\x",
    ])
      expect(() => safeDependencyPath(uri)).toThrow();
    expect(safeDependencyPath("textures/chair.jpg")).toBe("textures/chair.jpg");
  });
  it("checks exact source size/hash before assets enter public", () => {
    const bytes = Buffer.from("abc");
    expect(() =>
      verifyDownload(bytes, {
        size: 3,
        md5: "900150983cd24fb0d6963f7d28e17f72",
      }),
    ).not.toThrow();
    expect(() =>
      verifyDownload(bytes, {
        size: 4,
        md5: "900150983cd24fb0d6963f7d28e17f72",
      }),
    ).toThrow();
    expect(() =>
      verifyDownload(bytes, {
        size: 3,
        md5: "00000000000000000000000000000000",
      }),
    ).toThrow();
  });
});
