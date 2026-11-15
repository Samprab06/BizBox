import { it, expect } from "vitest";
import { createSpatialDraft, applySpatialCommand } from "@/lib/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import { buildInteriorProposal } from "./proposal-state";
it("maps metric furniture about an explicit room anchor without shrinking its dimensions", () => {
  const draft = applySpatialCommand(
    createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" }),
    {
      type: "add",
      id: "table",
      catalogId: FURNITURE_CATALOG[0]!.id,
      x: 2,
      z: 3,
      rotation: 90,
    },
  );
  const p = buildInteriorProposal(draft, {
    modelId: "qfmMbTLt4Bo",
    origin: { x: 10, y: 0.04, z: 20 },
    rotationY: Math.PI / 2,
    roomAnchor: { x: 1, z: 1 },
    source: "illustrative-reference",
  });
  expect(p.items[0]!.position.x).toBeCloseTo(12);
  expect(p.items[0]!.position.z).toBeCloseTo(19);
  expect(p.items[0]!.widthM).toBe(FURNITURE_CATALOG[0]!.widthM);
  expect(p.defurnish.available).toBeNull();
  expect(
    buildInteriorProposal(
      applySpatialCommand(draft, { type: "clear" }),
      p.calibration,
    ).items,
  ).toHaveLength(0);
});
it("rejects ambiguous calibration rather than borrowing replay scale", () => {
  const draft = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  expect(() =>
    buildInteriorProposal(draft, {
      modelId: "qfmMbTLt4Bo",
      origin: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      roomAnchor: { x: 0, z: 0 },
      source: "illustrative-reference",
      scale: 0.5,
    } as never),
  ).toThrow();
});
