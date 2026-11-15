import { expect, it } from "vitest";
import { createSpatialDraft } from "@/lib/spatial";
import type { InteriorResponse } from "@/lib/contracts/interior";
import { selectedScanCalibration } from "./selected-scan-calibration";
const draft = {
  ...createSpatialDraft({
    projectId: "gage-preset",
    siteId: "15423321:13450779",
    city: "los_angeles",
  }),
  room: { widthM: 4, depthM: 4, source: "assumed" as const },
};
const source: InteriorResponse = {
  kind: "scan",
  modelId: "a5JGo8bjyeP",
  provenance: {
    origin: "costar",
    provider: "costar",
    mode: "recorded",
    scope: "property",
    description: "Approved parent-property scan",
    limitations: ["Not measured suite geometry"],
  },
};
const authored = {
  modelId: "a5JGo8bjyeP",
  origin: { x: -5, y: 0.03, z: 0.2 },
  rotationY: 0,
  roomAnchor: { x: 0, z: 0 },
  source: "authored-preset" as const,
};
const scope = {
  projectId: draft.projectId,
  siteId: draft.siteId,
  widthM: 4,
  depthM: 4,
};
it("allows only the exact authored project, site, model and rectangle without claiming measured room bounds", () => {
  expect(selectedScanCalibration(source, draft, authored, scope)).toEqual(
    authored,
  );
  expect(draft.room.source).toBe("assumed");
  expect(
    selectedScanCalibration(
      source,
      { ...draft, projectId: "another" },
      authored,
      scope,
    ),
  ).toBeNull();
  expect(
    selectedScanCalibration(
      source,
      { ...draft, siteId: "another" },
      authored,
      scope,
    ),
  ).toBeNull();
  expect(
    selectedScanCalibration(
      { ...source, modelId: "Synthetic01" },
      draft,
      authored,
      scope,
    ),
  ).toBeNull();
  expect(
    selectedScanCalibration(
      source,
      { ...draft, room: { ...draft.room, widthM: 5 } },
      authored,
      scope,
    ),
  ).toBeNull();
  expect(selectedScanCalibration(source, draft, authored)).toBeNull();
});
it("uses an explicitly bound native floor placement without promoting assumed geometry", () => {
  const aligned = {
    ...draft,
    room: {
      ...draft.room,
      alignment: {
        source: "scan-floor-placement" as const,
        projectId: draft.projectId,
        siteId: draft.siteId,
        draftId: draft.id,
        modelId: source.kind === "scan" ? source.modelId : "",
        widthM: 4,
        depthM: 4,
        origin: { x: -2, y: 0.02, z: 3 },
        rotationY: Math.PI / 2,
        roomAnchor: { x: 2, z: 2 },
      },
    },
  };
  const calibration = selectedScanCalibration(source, aligned);
  expect(calibration).toMatchObject({
    source: "scan-floor-placement",
    origin: { x: -2, y: 0.02, z: 3 },
    roomAnchor: { x: 2, z: 2 },
  });
  expect(
    selectedScanCalibration({ ...source, modelId: "Synthetic01" }, aligned),
  ).toBeNull();
  expect(
    selectedScanCalibration(source, {
      ...aligned,
      room: { ...aligned.room, widthM: 5 },
    }),
  ).toBeNull();
});
