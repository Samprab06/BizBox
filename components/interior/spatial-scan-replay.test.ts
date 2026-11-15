import { expect, it } from "vitest";
import {
  createSpatialDraft,
  runSpatialExperiment,
  applySpatialCommand,
} from "@/lib/spatial";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import { spatialScanReplay } from "./spatial-scan-replay";
it("uses only the selected saved spatial run, its routes and identities", () => {
  const draft = createSpatialDraft({
    projectId: "p",
    siteId: "selected-la",
    city: "los_angeles",
    category: "coffee",
  });
  const result = runSpatialExperiment({
    baseline: draft,
    variant: draft,
    seeds: [11],
  });
  const run = result.variant.runs[0]!;
  const minute =
    run.events.find((event) => event.type === "service_start")!.timeMin + 0.1;
  const replay = spatialScanReplay(draft, run, minute, "");
  expect(replay.projectedLayout).toBeDefined();
  expect(replay.frame.motion.run.siteId).toBe("selected-la");
  for (const dot of replay.projectedLayout!.people.filter(
    (dot) => dot.role === "customer",
  ))
    expect(run.customers.some((customer) => customer.id === dot.id)).toBe(true);
  expect(spatialScanReplay(draft, run, minute, "")).toEqual(replay);
});
it("projects different saved experiment geometries instead of the reference cafe", () => {
  const baseline = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const chair = FURNITURE_CATALOG.find((item) => item.role === "seating")!;
  const variant = applySpatialCommand(baseline, {
    type: "add",
    id: "chair",
    catalogId: chair.id,
    x: 5,
    z: 4,
    rotation: 0,
  });
  const result = runSpatialExperiment({ baseline, variant, seeds: [11] });
  expect(result.variant.runs[0]!.routeLengthM).not.toBe(
    result.baseline.runs[0]!.routeLengthM,
  );
  expect(
    spatialScanReplay(variant, result.variant.runs[0]!, 500, "").frame.motion
      .run.events,
  ).toBe(result.variant.runs[0]!.events);
});
