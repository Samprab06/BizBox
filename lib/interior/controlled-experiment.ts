import {
  ControlledInteriorFindingSchema,
  SpatialDraftSchema,
  type SpatialDraft,
  type SpatialExperimentResult,
} from "@/lib/contracts/spatial";
import { applySpatialCommand } from "@/lib/spatial";
import { furnitureById } from "@/lib/furniture/catalog";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const HELD_FIXED = [
  "Arriving customer workload and paired random seeds",
  "Operating hours, service time, price, wage and COGS",
  "Staff and fixed service-resource capacity",
  "Room, entrance, service point and all existing proposed furniture",
];
/** A new experiment starts from the current proposal, never an older original room. */
export function prepareControlledFurnitureExperiment(input: {
  current: SpatialDraft;
  catalogId: string;
  itemId: string;
  position: { x: number; z: number; rotation?: 0 | 90 | 180 | 270 };
  question: string;
}) {
  const baseline = structuredClone(SpatialDraftSchema.parse(input.current));
  if (!input.question.trim() || input.question.length > 1000)
    throw Error("Provide a bounded experiment question");
  if (!furnitureById(input.catalogId))
    throw Error("Unknown furniture catalog item");
  if (baseline.items.some((i) => i.id === input.itemId))
    throw Error("Use a new proposed item ID");
  const variant = applySpatialCommand(baseline, {
    type: "add",
    id: input.itemId,
    catalogId: input.catalogId,
    x: input.position.x,
    z: input.position.z,
    rotation: input.position.rotation ?? 0,
  });
  return {
    question: input.question.trim(),
    baseline,
    variant,
    heldFixed: [...HELD_FIXED],
  };
}
/** Derived solely from a completed engine pair. No observed-business or isolated furniture economics claims. */
export function buildControlledExperimentFinding(input: {
  question: string;
  baseline: SpatialDraft;
  variant: SpatialDraft;
  result: SpatialExperimentResult;
}) {
  const { baseline, variant, result } = input;
  const expected = structuredClone(variant);
  expected.items = baseline.items;
  expected.revision = baseline.revision;
  if (
    !same(expected, baseline) ||
    variant.items.length !== baseline.items.length + 1 ||
    !same(variant.items.slice(0, -1), baseline.items) ||
    !same(result.baseline.draft, baseline) ||
    !same(result.variant.draft, variant)
  )
    throw Error("Result is not a controlled single furniture addition");
  const added = variant.items.at(-1)!,
    item = furnitureById(added.catalogId);
  if (!item) throw Error("Unknown furniture catalog item");
  const summarize = (
    summary: SpatialExperimentResult["baseline"]["metrics"],
  ) => ({
    routeLengthM: summary.routeLengthM,
    walkingDelayMin: Object.fromEntries(
      Object.entries(summary.routeLengthM).map(([key, value]) => [
        key,
        value === null ? null : value / 60,
      ]),
    ) as typeof summary.routeLengthM,
    served: summary.served,
    meanWaitMin: summary.meanWaitMin,
    left: summary.abandoned,
    revenueUsd: summary.revenueUsd,
    dailyContributionUsd: summary.dailyContributionUsd,
  });
  const metrics = summarize(result.delta),
    before = summarize(result.baseline.metrics),
    after = summarize(result.variant.metrics);
  return ControlledInteriorFindingSchema.parse({
    question: input.question,
    change: {
      type: "add" as const,
      item: structuredClone(added),
      name: item.name,
    },
    source: result.source,
    seeds: [...result.seeds],
    heldFixed: [...HELD_FIXED],
    before,
    after,
    metrics,
    findings: [
      `Added one ${item.name}; all operational inputs and existing proposed objects held fixed.`,
      `Paired modeled served change: ${metrics.served.mean}; route change: ${metrics.routeLengthM.mean} m.`,
      `Paired modeled daily operating contribution change: $${metrics.dailyContributionUsd.mean.toFixed(2)} before furniture purchase, rent and other overhead.`,
    ],
    limitations: [
      ...result.limitations,
      item.role === "table"
        ? "A table alone adds no modeled seats or service capacity. Furniture affects obstacles/routes and supported policy observations only; furniture-specific behavior may be uncovered."
        : item.role === "seating"
          ? `This seating asset adds ${item.seats} modeled available seat(s), not staff or service capacity. Seat availability is a preference observation, not a measured demand increase or seating occupancy simulation.`
          : "This asset changes obstacles/routes and supported policy observations only; no staff, seats or service capacity are inferred from its appearance.",
      "Zero or unfavorable differences are valid model outcomes. These paired seed ranges are not observed causal estimates or statistical confidence intervals.",
      "Wait change is unavailable when either paired run has no completed customers. Walking delay enters arrival-to-service routing; route length is reported separately from queue waiting time.",
    ],
  });
}
