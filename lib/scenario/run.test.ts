import { describe, expect, it, vi } from "vitest";
import { createScenarioRunner, scenarioExecutionKey } from "./run";
import { createMemoryScenarioExecutionStore } from "./run-store-memory";
import { createRootScenario, deriveScenario } from "./model";
import { createMemoryComparisonStore } from "@/lib/evaluation/store";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import { FIXTURE_PERSONA_SET, SITE_A, SITE_B } from "@/lib/demand/fixtures";
import { evaluateSitesResumable } from "@/lib/evaluation/evaluate";
import { LayoutInputError } from "@/lib/layout";

const config = {
  hours: {
    weekday: { openMin: 360, closeMin: 1080 },
    weekend: { openMin: 360, closeMin: 1080 },
  },
  stations: { planned: 2, usableSf: 1800, sfPerStation: 100 },
  prices: { avgTicketUsd: 6.5 },
  staff: { headcount: 2, wageUsdPerHour: 16 },
  costs: { cogsPctOfRevenue: 0.28 },
  lease: {
    sf: 1800,
    askingRentUsdPerSfYear: 24,
    tripleNet: false,
    buildoutUsd: 30000,
    leaseTermMonths: 60,
  },
  calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
};
const base = createRootScenario({
  id: "s1",
  projectId: "p1",
  siteIds: [SITE_A.id, SITE_B.id],
  profileVersion: 1,
  label: "Baseline",
  author: "founder",
  createdAt: "2026-11-14T16:00:00.000Z",
  overrides: {
    seedSet: {
      value: [2, 7],
      unit: "seeds",
      origin: "default",
      evidenceIds: ["fixture"],
    },
  },
});
function setup(budgetUnits = 1200) {
  const scenarios = new Map([[base.id, base]]);
  const executions = createMemoryScenarioExecutionStore();
  const comparisons = createMemoryComparisonStore({ p1: 1 });
  let sequence = 0;
  const prepare = vi.fn(async () => ({
    request: EvaluationRequestSchema.parse({
      projectId: "p1",
      profileId: "profile-v1",
      profileVersion: 1,
      synthetic: true,
      city: "houston",
      category: "coffee",
      priceTier: "mid",
      personaSet: FIXTURE_PERSONA_SET,
      demandSource: "huff",
      seeds: 2,
      seedSet: [2, 7],
      sites: [SITE_A, SITE_B].map((storefront) => ({
        siteId: storefront.id,
        storefront,
        config,
      })),
    }),
    findings: [],
    assumptions: {},
  }));
  const evaluate = vi.fn(evaluateSitesResumable);
  const runner = createScenarioRunner({
    scenarios: {
      get: async (projectId, id) =>
        scenarios.get(id)?.projectId === projectId ? scenarios.get(id)! : null,
    },
    executions,
    comparisons,
    prepare,
    evaluate,
    budgetUnits,
    newId: () => `execution-${++sequence}`,
    now: () => new Date("2026-11-14T17:00:00.000Z"),
  });
  return { runner, prepare, evaluate, scenarios, comparisons, executions };
}

describe("scenario execution", () => {
  it("reserves no work and does not assemble or simulate an over-budget request", async () => {
    const { runner, prepare, evaluate } = setup(7);
    expect(await runner.start("p1", "s1", {})).toEqual({
      status: "needs_confirmation",
      costUnits: 8,
      remainingUnits: 7,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and records confirmed cost", async () => {
    const { runner, executions } = setup(7);
    const result = await runner.start("p1", "s1", {
      confirm: true,
      idempotencyKey: "confirmed",
    });
    expect(result).toMatchObject({
      status: "succeeded",
      cached: false,
      costUnits: 8,
    });
    expect((await executions.get("p1", "execution-1"))?.costUnits).toBe(8);
  });
  it("reuses a parent's cached comparison for an equivalent fork at zero cost", async () => {
    const { runner, scenarios, prepare, evaluate } = setup();
    const parent = await runner.start("p1", "s1", {});
    scenarios.set(
      "s2",
      deriveScenario(
        base,
        { label: "Same inputs" },
        { id: "s2", createdAt: "2026-11-14T17:00:00.000Z", author: "founder" },
      ),
    );
    const child = await runner.start("p1", "s2", {});
    expect(child).toMatchObject({
      status: "succeeded",
      cached: true,
      costUnits: 0,
      scenarioId: "s2",
    });
    expect(
      "comparisonId" in child && "comparisonId" in parent && child.comparisonId,
    ).toBe("comparisonId" in parent && parent.comparisonId);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it("repeating an idempotency key returns the same run without new work", async () => {
    const { runner, prepare } = setup();
    const a = await runner.start("p1", "s1", { idempotencyKey: "same" });
    const b = await runner.start("p1", "s1", { idempotencyKey: "same" });
    expect(b).toEqual(a);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("cannot read or advance another project's execution", async () => {
    const { runner } = setup();
    const a = await runner.start("p1", "s1", {});
    if (!("runId" in a)) throw new Error("Expected execution");
    await expect(runner.advance("p2", "s1", a.runId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(runner.start("p2", "s1", {})).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("rejects unknown confirmation/budget fields", async () => {
    await expect(
      setup().runner.start("p1", "s1", { confirm: "yes" }),
    ).rejects.toThrow();
    await expect(
      setup().runner.start("p1", "s1", { budgetUnits: 999999 }),
    ).rejects.toThrow();
  });
  it("resumes from a persisted site checkpoint without reassembling or repeating it", async () => {
    const { runner, prepare, evaluate } = setup();
    evaluate.mockImplementationOnce((input, options) => {
      let tick = 0;
      return evaluateSitesResumable(input, {
        ...options,
        deadlineAt: 1,
        now: () => tick++,
      });
    });
    const first = await runner.start("p1", "s1", { idempotencyKey: "resume" });
    expect(first).toMatchObject({
      status: "running",
      completedSiteIds: [SITE_A.id],
    });
    if (!("runId" in first)) throw new Error("Expected execution");
    const final = await runner.advance("p1", "s1", first.runId);
    expect(final.status).toBe("succeeded");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[1][1]?.completed).toHaveProperty(SITE_A.id);
  });
  it("concurrent distinct requests cannot both spend the last available work units", async () => {
    const { runner, scenarios, prepare } = setup(8);
    scenarios.set(
      "s2",
      deriveScenario(
        base,
        {
          overrides: {
            ...base.overrides,
            demandMultiplier: {
              value: 2,
              unit: "multiplier",
              origin: "default",
              evidenceIds: ["fixture"],
            },
          },
        },
        { id: "s2", createdAt: "2026-11-14T17:00:00.000Z", author: "founder" },
      ),
    );
    const results = await Promise.all([
      runner.start("p1", "s1", {}),
      runner.start("p1", "s2", {}),
    ]);
    expect(results.filter((r) => r.status === "succeeded")).toHaveLength(1);
    expect(
      results.filter((r) => r.status === "needs_confirmation"),
    ).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("a transient assembly failure can retry the default request without a second reservation", async () => {
    const { runner, prepare, executions } = setup(8);
    prepare.mockRejectedValueOnce(new Error("temporary source failure"));
    await expect(runner.start("p1", "s1", {})).rejects.toThrow("temporary");
    const result = await runner.start("p1", "s1", {});
    expect(result).toMatchObject({
      status: "succeeded",
      runId: "execution-1",
      costUnits: 8,
    });
    expect((await executions.get("p1", "execution-1"))?.costUnits).toBe(8);
  });
  it("terminalizes deterministic layout errors while preserving their field errors", async () => {
    const { runner, prepare, executions } = setup();
    const invalid = new LayoutInputError({
      "scenario.overrides.plannedStations": ["Conflicts with selected layout"],
    });
    prepare.mockRejectedValueOnce(invalid);
    await expect(runner.start("p1", "s1", {})).rejects.toBe(invalid);
    expect((await executions.get("p1", "execution-1"))?.status).toBe("failed");
    expect(await runner.get("p1", "s1", "execution-1")).toMatchObject({
      status: "failed",
    });
  });
});

it("versions helper artifacts in the cache while preserving queued legacy Jev source", async () => {
  const oldKey = scenarioExecutionKey(base, "jev", null);
  expect(scenarioExecutionKey(base, "jev")).not.toBe(oldKey);
  expect(scenarioExecutionKey(base, "jev")).toBe(
    scenarioExecutionKey(base, "jev"),
  );
  const { runner, executions, prepare } = setup();
  await executions.reserve({
    id: "legacy",
    projectId: "p1",
    scenarioId: "s1",
    idempotencyKey: oldKey,
    effectiveKey: oldKey,
    costUnits: 8,
    budgetUnits: 1200,
    confirm: false,
    now: new Date("2026-11-14T17:00:00.000Z"),
  });
  await runner.advance("p1", "s1", "legacy");
  expect(prepare).toHaveBeenCalledWith(base, "jev");
  const result = await runner.start("p1", "s1", { demandSource: "jev" });
  expect(result).toMatchObject({
    status: "succeeded",
    cached: false,
    costUnits: 8,
  });
});
