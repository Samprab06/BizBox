import { describe, expect, it } from "vitest";
import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import { SpatialExperimentResultSchema } from "@/lib/contracts/spatial";
import {
  applySpatialCommand,
  createSpatialDraft,
  runSpatialExperiment,
  spatialReadiness,
  getSpatialPolicyStates,
} from "./index";
const create = () =>
  createSpatialDraft({ projectId: "p", siteId: "s", city: "houston" });
describe("spatial experiments", () => {
  it("keeps immutable revisions and supports add/remove/clear", () => {
    const a = create();
    const b = applySpatialCommand(a, {
      type: "add",
      catalogId: FURNITURE_CATALOG[0]!.id,
      id: "table",
      x: 2,
      z: 3,
      rotation: 0,
    });
    expect(a.items).toHaveLength(0);
    expect(b.revision).toBe(a.revision + 1);
    expect(
      applySpatialCommand(b, { type: "remove", id: "table" }).items,
    ).toHaveLength(0);
    expect(applySpatialCommand(b, { type: "clear" }).items).toHaveLength(0);
  });
  it("rejects unknown furniture and out of room placement atomically", () => {
    const a = create();
    expect(() =>
      applySpatialCommand(a, {
        type: "add",
        catalogId: "missing",
        id: "x",
        x: 2,
        z: 2,
        rotation: 0,
      }),
    ).toThrow();
    expect(() =>
      applySpatialCommand(a, {
        type: "add",
        catalogId: FURNITURE_CATALOG[0]!.id,
        id: "x",
        x: -1,
        z: 0,
        rotation: 0,
      }),
    ).toThrow();
    expect(a.items).toHaveLength(0);
  });
  it("reproduces decisions and conserved results without claiming Jev", () => {
    const a = create();
    const result = runSpatialExperiment({
      baseline: a,
      variant: a,
      seeds: [1, 2],
    });
    expect(
      runSpatialExperiment({ baseline: a, variant: a, seeds: [1, 2] }),
    ).toEqual(result);
    expect(SpatialExperimentResultSchema.safeParse(result).success).toBe(true);
    expect(result.delta.served.mean).toBe(0);
    expect(result.source).toBe("assumed");
    for (const run of result.variant.runs) {
      expect(run.metrics.arrivals).toBe(
        run.metrics.served +
          run.metrics.abandoned +
          run.metrics.inServiceAtClose +
          run.metrics.waitingAtClose +
          run.walkingAtClose,
      );
    }
  });
  it("scope-checks variants and supports explicit appointment adapter", () => {
    const a = create();
    expect(() =>
      runSpatialExperiment({ baseline: a, variant: { ...a, siteId: "other" } }),
    ).toThrow();
    expect(spatialReadiness({ ...a, category: "salon_barber" }).runnable).toBe(
      true,
    );
  });
  it("binds external policies to their exact geometry and changes actual engine choices", () => {
    const a = create();
    const states = runSpatialExperiment({ baseline: a, variant: a, seeds: [1] })
      .variant.policyStates;
    const policy = {
      source: "jev" as const,
      modelVersion: "recorded-test",
      evidenceId: "test-response",
      states: states.map((s) => ({
        ...s,
        stayByQueue: [
          { lineLength: 0, p: 0 },
          { lineLength: 10, p: 0 },
        ],
      })),
    };
    const r = runSpatialExperiment({
      baseline: a,
      variant: a,
      seeds: [1],
      policies: { baseline: policy, variant: policy },
    });
    expect(r.variant.runs[0]!.metrics.served).toBe(0);
    expect(r.variant.metrics.meanWaitMin.mean).toBeNull();
    expect(
      r.variant.runs[0]!.decisions.every((d) => d.action === "leave"),
    ).toBe(true);
    expect(() =>
      runSpatialExperiment({
        baseline: a,
        variant: a,
        seeds: [1],
        policies: { baseline: { ...policy, states: [] }, variant: policy },
      }),
    ).toThrow();
  });
  it("furniture changes route and actual decisions; neutral metadata does not", () => {
    const a = create();
    const obstacle = FURNITURE_CATALOG.find((c) => c.role === "storage")!;
    const b = applySpatialCommand(a, {
      type: "add",
      id: "shelf",
      catalogId: obstacle.id,
      x: 5,
      z: 4,
      rotation: 0,
    });
    const r = runSpatialExperiment({ baseline: a, variant: b, seeds: [1] });
    expect(r.delta.routeLengthM.mean).toBeGreaterThan(0);
    expect(
      r.variant.runs[0]!.customers[0]!.queueArrivalMin -
        r.variant.runs[0]!.customers[0]!.arrivalMin,
    ).toBeGreaterThan(
      r.baseline.runs[0]!.customers[0]!.queueArrivalMin -
        r.baseline.runs[0]!.customers[0]!.arrivalMin,
    );
    expect(r.variant.runs[0]!.decisions[0]!.policyKey).not.toBe(
      r.baseline.runs[0]!.decisions[0]!.policyKey,
    );
    expect(
      runSpatialExperiment({
        baseline: a,
        variant: { ...a, revision: 1 },
        seeds: [1],
      }).delta.served.mean,
    ).toBe(0);
  });
  it("has distinct process semantics across all four categories and both cities", () => {
    const adapters = new Set<string>();
    for (const city of ["houston", "los_angeles"] as const)
      for (const category of [
        "coffee",
        "quick_food",
        "salon_barber",
        "fitness",
      ] as const) {
        const a = createSpatialDraft({
          projectId: "p",
          siteId: "s",
          city,
          category,
        });
        const result = runSpatialExperiment({
          baseline: a,
          variant: a,
          seeds: [2],
        });
        const run = result.variant.runs[0]!;
        expect(result.variant.draft.timezone).toBe(
          city === "houston" ? "America/Chicago" : "America/Los_Angeles",
        );
        adapters.add(run.adapter);
        expect(run.metrics.arrivals).toBe(
          run.metrics.served +
            run.metrics.abandoned +
            run.metrics.inServiceAtClose +
            run.metrics.waitingAtClose +
            run.walkingAtClose,
        );
        if (category === "quick_food")
          expect(run.stageEvents.some((e) => e.stage === "pickup")).toBe(true);
        if (category === "salon_barber")
          expect(run.stageEvents.some((e) => e.stage === "appointment")).toBe(
            true,
          );
        if (category === "fitness")
          expect(
            run.stageEvents.every(
              (e) => (e.startMin - a.settings.openMin) % 30 === 0,
            ),
          ).toBe(true);
      }
    expect(adapters.size).toBe(4);
  });
  it("preserves near-close walkers and rejects timezone mismatch", () => {
    const a = create();
    const b = applySpatialCommand(a, {
      type: "settings",
      settings: { ...a.settings, openMin: 480, closeMin: 481, arrivals: 500 },
    });
    const r = runSpatialExperiment({ baseline: b, variant: b, seeds: [1] });
    const run = r.variant.runs[0]!;
    expect(run.walkingAtClose).toBeGreaterThan(0);
    expect(run.metrics.arrivals).toBe(
      run.metrics.served +
        run.metrics.abandoned +
        run.metrics.inServiceAtClose +
        run.metrics.waitingAtClose +
        run.walkingAtClose,
    );
    expect(
      spatialReadiness({ ...a, timezone: "America/Los_Angeles" }).runnable,
    ).toBe(false);
  });
  it("rejects overlapping edits, duplicate identities and unsafe seed workloads", () => {
    const a = create();
    const item = FURNITURE_CATALOG[0]!;
    const b = applySpatialCommand(a, {
      type: "add",
      id: "one",
      catalogId: item.id,
      x: 2,
      z: 3,
      rotation: 0,
    });
    expect(() =>
      applySpatialCommand(b, {
        type: "add",
        id: "two",
        catalogId: item.id,
        x: 2,
        z: 3,
        rotation: 0,
      }),
    ).toThrow("overlap");
    expect(() =>
      applySpatialCommand(b, {
        type: "add",
        id: "one",
        catalogId: item.id,
        x: 7,
        z: 3,
        rotation: 0,
      }),
    ).toThrow("Duplicate");
    expect(() =>
      applySpatialCommand(b, { type: "remove", id: "absent" }),
    ).toThrow("not found");
    expect(() =>
      runSpatialExperiment({ baseline: a, variant: a, seeds: [1, 1] }),
    ).toThrow();
    expect(b.items).toHaveLength(1);
  });
  it("makes staffing constrain salon chairs and clear does not invent resources", () => {
    const a = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
      category: "salon_barber",
    });
    const b = applySpatialCommand(a, {
      type: "settings",
      settings: { ...a.settings, staff: 1, resourceCapacity: 8 },
    });
    const r = runSpatialExperiment({
      baseline: a,
      variant: applySpatialCommand(b, { type: "clear" }),
      seeds: [3],
    });
    expect(r.variant.runs[0]!.capacity).toBe(1);
    expect(r.variant.runs[0]!.adapter).toBe("appointment-chair");
    expect(r.variant.draft.limitations.join(" ")).toContain(
      "Fixed service infrastructure",
    );
  });
  it("includes still-waiting eventual abandoners in observed queue length", () => {
    const a = create();
    const b = applySpatialCommand(a, {
      type: "settings",
      settings: {
        ...a.settings,
        arrivals: 100,
        closeMin: 500,
        serviceMin: 240,
        staff: 1,
      },
    });
    const r = runSpatialExperiment({ baseline: b, variant: b, seeds: [1] });
    expect(r.variant.runs[0]!.decisions.some((d) => d.queueLength > 0)).toBe(
      true,
    );
  });
});

it("observes changed employee/service capacity and queue wait for a second staffed counter", () => {
  const baseline = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const one = applySpatialCommand(baseline, {
    type: "settings",
    settings: { ...baseline.settings, staff: 1, resourceCapacity: 1 },
  });
  const two = applySpatialCommand(one, {
    type: "settings",
    settings: { ...one.settings, staff: 2, resourceCapacity: 2 },
  });
  const a = getSpatialPolicyStates(one)[0]!,
    b = getSpatialPolicyStates(two)[0]!;
  expect(a.serviceCapacity).toBe(1);
  expect(b.serviceCapacity).toBe(2);
  expect(b.queueWaitMinPerPerson).toBe(a.queueWaitMinPerPerson / 2);
  expect(a.key).not.toBe(b.key);
});
