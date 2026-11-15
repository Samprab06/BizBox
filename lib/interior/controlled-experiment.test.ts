import { describe, it, expect } from "vitest";
import {
  createSpatialDraft,
  applySpatialCommand,
  runSpatialExperiment,
} from "@/lib/spatial";
import {
  prepareControlledFurnitureExperiment,
  buildControlledExperimentFinding,
} from "./controlled-experiment";
function setup() {
  const current = applySpatialCommand(
    createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" }),
    {
      type: "settings",
      settings: {
        ...createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" })
          .settings,
        staff: 1,
        resourceCapacity: 1,
      },
    },
  );
  return prepareControlledFurnitureExperiment({
    current,
    catalogId: "round_wooden_table_02",
    itemId: "table-new",
    position: { x: 5, z: 4 },
    question: "What if we add one table?",
  });
}
describe("controlled one furniture experiment", () => {
  it("starts from current layout and holds every operational input fixed", () => {
    const p = setup();
    expect(p.variant.settings).toEqual(p.baseline.settings);
    expect(p.variant.items).toHaveLength(p.baseline.items.length + 1);
    expect(p.baseline.items).toHaveLength(0);
    expect(p.variant.items[0]?.catalogId).toBe("round_wooden_table_02");
    const result = runSpatialExperiment({ ...p });
    const finding = buildControlledExperimentFinding({ ...p, result });
    expect(finding.metrics.served).toEqual(result.delta.served);
    expect(finding.before.served).toEqual(result.baseline.metrics.served);
    expect(finding.after.served).toEqual(result.variant.metrics.served);
    expect(finding.metrics.left).toEqual(result.delta.abandoned);
    expect(finding.limitations.join(" ")).toMatch(/table.*seat|seating/i);
  });
  it("rejects extra staff changes rather than attributing them to table", () => {
    const p = setup(),
      variant = applySpatialCommand(p.variant, {
        type: "settings",
        settings: { ...p.variant.settings, staff: 2 },
      });
    const result = runSpatialExperiment({ baseline: p.baseline, variant });
    expect(() =>
      buildControlledExperimentFinding({ ...p, variant, result }),
    ).toThrow(/controlled/i);
  });
});

it("allows a genuine zero-effect table placement and preserves paired seeds/workload", () => {
  const current = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const pair = prepareControlledFurnitureExperiment({
    current,
    catalogId: "round_wooden_table_02",
    itemId: "aside-table",
    position: { x: 2, z: 2 },
    question: "Does an off-route table change performance?",
  });
  const result = runSpatialExperiment({ ...pair, seeds: [11, 29, 47] });
  const finding = buildControlledExperimentFinding({ ...pair, result });
  expect(finding.metrics.routeLengthM.mean).toBe(0);
  expect(finding.metrics.served.mean).toBe(0);
  expect(result.baseline.runs.map((r) => r.seed)).toEqual(
    result.variant.runs.map((r) => r.seed),
  );
  expect(result.baseline.runs.map((r) => r.customers.map((c) => c.id))).toEqual(
    result.variant.runs.map((r) => r.customers.map((c) => c.id)),
  );
  expect(finding.seeds).toEqual([11, 29, 47]);
});

it("reports seating observations honestly for a chair rather than table-only limitations", () => {
  const pair = prepareControlledFurnitureExperiment({
    current: createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    }),
    catalogId: "painted_wooden_chair_01",
    itemId: "chair",
    position: { x: 2, z: 2 },
    question: "Test one chair",
  });
  const finding = buildControlledExperimentFinding({
    ...pair,
    result: runSpatialExperiment(pair),
  });
  expect(finding.limitations.join(" ")).toContain(
    "adds 1 modeled available seat",
  );
  expect(finding.limitations.join(" ")).not.toContain("A table alone");
});
