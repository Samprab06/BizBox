import { describe, expect, it } from "vitest";
import type { InteriorResponse } from "@/lib/contracts/interior";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import { prepareSpatialDraft, spatialScanCalibration } from "./prepare-spatial";

function scan(origin = 10, modelId = "Synthetic01"): InteriorResponse {
  const provenance = {
    origin: "matterport" as const,
    provider: "matterport" as const,
    mode: "recorded" as const,
    scope: "space" as const,
    description: "Synthetic test envelope, not a real property",
    limitations: [],
  };
  const bounds = {
    min: { x: origin, y: 2, z: -20 },
    max: { x: origin + 12, y: 5, z: -14 },
  };
  return {
    kind: "scan",
    modelId,
    provenance,
    dimensions: {
      coordinateUnit: "meters",
      areaUnit: "square_feet",
      upAxis: "y",
      coordinateFrame: "showcase-y-up-v1",
      provenance,
      floors: [
        {
          id: "floor",
          areaSqFt: 800,
          bounds,
          rooms: [{ id: "room", areaSqFt: 700, bounds }],
        },
      ],
    },
  };
}
const base = () =>
  createSpatialDraft({ projectId: "p", siteId: "1:2", city: "houston" });

describe("selected scan to spatial experiment", () => {
  it("uses selected suite room extents and native origin, keeps operating settings", () => {
    const response = scan();
    const draft = prepareSpatialDraft(base(), response);
    expect(draft.room).toMatchObject({
      widthM: 12,
      depthM: 6,
      source: "matterport-bounds",
    });
    expect(draft.settings).toEqual(base().settings);
    expect(draft.siteId).toBe("1:2");
    expect(spatialScanCalibration(response, draft)).toMatchObject({
      modelId: "Synthetic01",
      origin: { x: 10, y: 2, z: -20 },
      rotationY: 0,
      roomAnchor: { x: 0, z: 0 },
    });
    expect(draft.limitations.join(" ")).toMatch(/bounds|envelope/);
    expect(draft.limitations.join(" ")).toMatch(/entrance|service/i);
  });
  it("does not share another model's transform across buildings", () => {
    const a = scan(),
      b = scan(100, "Synthetic02");
    expect(
      spatialScanCalibration(a, prepareSpatialDraft(base(), a))?.origin.x,
    ).toBe(10);
    expect(
      spatialScanCalibration(b, prepareSpatialDraft(base(), b))?.origin.x,
    ).toBe(100);
  });
  it("does not promote parent-property geometry or unknown dimensions", () => {
    const property = scan();
    property.provenance.scope = "property";
    expect(prepareSpatialDraft(base(), property)).toEqual(base());
    expect(spatialScanCalibration(property, base())).toBeNull();
    const unknown: InteriorResponse = {
      kind: "modeled",
      provenance: property.provenance,
    };
    expect(prepareSpatialDraft(base(), unknown)).toEqual(base());
  });
  it("rejects stale extents and refuses unsupported room sizes instead of clipping", () => {
    const response = scan(),
      draft = prepareSpatialDraft(base(), response);
    expect(
      spatialScanCalibration(response, {
        ...draft,
        room: { ...draft.room, widthM: 11 },
      }),
    ).toBeNull();
    if (response.kind !== "scan" || !response.dimensions) throw new Error();
    response.dimensions.floors[0]!.rooms[0]!.bounds.max.x = 100;
    response.dimensions.floors[0]!.bounds.max.x = 100;
    expect(prepareSpatialDraft(base(), response)).toEqual(base());
  });
  it("preserves proposed items for the flow to handle explicitly", () => {
    const item = applySpatialCommand(base(), {
      type: "add",
      catalogId: "painted_wooden_chair_01",
      id: "chair",
      x: 2,
      z: 2,
      rotation: 0,
    });
    // Preparation must never silently reposition or drop an existing proposal.
    expect(prepareSpatialDraft(item, scan())).toEqual(item);
  });
});

it("allows scoped entrance/service edits to change routing without moving furniture", () => {
  const before = base();
  const after = applySpatialCommand(before, {
    type: "layout",
    entrance: { x: 1, z: 0.5 },
    servicePoint: { x: 8, z: 7 },
  });
  expect(before.entrance).toEqual({ x: 5, z: 0.5 });
  expect(after.entrance).toEqual({ x: 1, z: 0.5 });
  expect(after.revision).toBe(before.revision + 1);
  expect(() =>
    applySpatialCommand(before, {
      type: "layout",
      entrance: { x: -1, z: 0 },
      servicePoint: before.servicePoint,
    }),
  ).toThrow();
});

it("rejects another scan with identical extents and rejects non-Matterport dimension provenance", () => {
  const a = scan(),
    b = scan(100, "Synthetic02");
  const draft = prepareSpatialDraft(base(), a);
  expect(spatialScanCalibration(b, draft)).toBeNull();
  const moved = scan(20);
  expect(spatialScanCalibration(moved, draft)).toBeNull();
  const wrong = scan();
  if (wrong.kind !== "scan" || !wrong.dimensions) throw new Error();
  wrong.dimensions.provenance.provider = "modeled";
  wrong.dimensions.provenance.origin = "default";
  expect(prepareSpatialDraft(base(), wrong)).toEqual(base());
});

it("does not align scan overlays with legacy unversioned coordinate caches", () => {
  const response = scan();
  if (response.kind !== "scan" || !response.dimensions) throw new Error();
  delete response.dimensions.coordinateFrame;
  expect(prepareSpatialDraft(base(), response)).toEqual(base());
  expect(spatialScanCalibration(response, base())).toBeNull();
});

it("accepts a CoStar scan mapping when the independently sourced geometry is Matterport", () => {
  const response = scan();
  response.provenance = {
    ...response.provenance,
    origin: "costar",
    provider: "costar",
  };
  expect(prepareSpatialDraft(base(), response).room.source).toBe(
    "matterport-bounds",
  );
});
