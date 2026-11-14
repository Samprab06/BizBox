import { describe, expect, it, vi } from "vitest";
import { EvaluationRequestSchema } from "@/lib/contracts/evaluation";
import {
  FIXTURE_PERSONA_SET,
  SITE_A,
  SITE_B,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import {
  buildStoredComparison,
  createMemoryComparisonStore,
} from "@/lib/evaluation/store";
import {
  evaluateSites,
  evaluateSitesResumable,
} from "@/lib/evaluation/evaluate";
import { createMemoryScenarioExecutionStore } from "@/lib/scenario/run-store-memory";
import { createScenarioRunner } from "@/lib/scenario/run";
import type { Scenario } from "@/lib/contracts/scenario";
import { stationExperimentsFromComparisons } from "./station-experiment-producer";
import {
  createStationExperimentService,
  prepareStationExperimentScenario,
  withStationExperimentSnapshots,
} from "./station-experiment-service";

const config = {
  hours: {
    weekday: { openMin: 420, closeMin: 480 },
    weekend: { openMin: 420, closeMin: 500 },
  },
  stations: { planned: 1, usableSf: 1200, sfPerStation: 250 },
  service: { meanServiceMin: 5 },
  prices: { avgTicketUsd: 8 },
  staff: { headcount: 1, wageUsdPerHour: 18 },
  costs: { cogsPctOfRevenue: 0.3 },
  lease: {
    sf: 1200,
    askingRentUsdPerSfYear: 30,
    tripleNet: false,
    buildoutUsd: 9000,
    leaseTermMonths: 36,
  },
  calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
};
async function setup(budgetUnits = 1200) {
  const request = EvaluationRequestSchema.parse({
    projectId: "p",
    profileId: "profile",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    demandSource: "huff",
    seedSet: [11, 22],
    overrides: { ticketMultiplier: 1.2 },
    sites: [SITE_A, SITE_B].map((storefront) => ({
      siteId: storefront.id,
      storefront,
      config,
    })),
  });
  const source = buildStoredComparison(
    "source",
    request,
    evaluateSites(request),
  );
  const comparisons = createMemoryComparisonStore();
  await comparisons.save(source);
  const rows = new Map<string, Scenario>();
  const scenarios = {
    get: vi.fn(async (projectId: string, id: string) =>
      rows.get(id)?.projectId === projectId
        ? structuredClone(rows.get(id)!)
        : null,
    ),
    insert: vi.fn(async (value: Scenario) => {
      if (rows.has(value.id)) throw new Error("duplicate");
      rows.set(value.id, structuredClone(value));
      return value;
    }),
  };
  const executions = createMemoryScenarioExecutionStore();
  const evaluate = vi.fn(evaluateSitesResumable);
  const service = createStationExperimentService({
    comparisons,
    scenarios,
    executions,
    evaluate,
    budgetUnits,
  });
  const input = { comparisonId: source.id, siteId: SITE_A.id };
  return {
    service,
    comparisons,
    source,
    rows,
    scenarios,
    executions,
    evaluate,
    input,
  };
}

describe("budgeted immutable station experiments", () => {
  it("GET plans exact whole-day settings without writes or runs", async () => {
    const s = await setup();
    const plan = await s.service.get("p", s.input);
    expect(plan.status).toBe("planned");
    expect(
      plan.configurations.map((c) => [
        c.id,
        c.plannedStations,
        c.staffHeadcount,
        c.costUnits,
      ]),
    ).toEqual([
      ["baseline", 1, 1, 4],
      ["plus-one", 2, 2, 4],
      ["plus-two", 3, 3, 4],
    ]);
    expect(plan.nextConfigurationId).toBe("baseline");
    expect(s.rows.size).toBe(0);
    expect(s.evaluate).not.toHaveBeenCalled();
    expect(
      await s.executions.get("p", plan.configurations[0].runId),
    ).toBeNull();
  });
  it("executes one named configuration, preserves immutable inputs and uses the exact producer", async () => {
    const s = await setup();
    const original = structuredClone(s.source);
    const first = await s.service.post("p", {
      ...s.input,
      configurationId: "baseline",
    });
    expect(first.configurations[0]).toMatchObject({
      status: "succeeded",
      costUnits: 4,
      cached: false,
    });
    expect(first.configurations[1].status).toBe("planned");
    expect(s.evaluate).toHaveBeenCalledTimes(1);
    for (const configurationId of ["plus-one", "plus-two"])
      await s.service.post("p", { ...s.input, configurationId });
    const final = await s.service.get("p", s.input);
    expect(final.status).toBe("ready");
    expect(final.nextConfigurationId).toBeNull();
    const records = await Promise.all(
      final.configurations.map((c) => s.comparisons.load("p", c.comparisonId!)),
    );
    expect(final.result).toEqual(
      stationExperimentsFromComparisons({
        baseline: records[0]!,
        alternatives: records.slice(1).map((comparison, i) => ({
          id: final.configurations[i + 1].id,
          comparison: comparison!,
        })),
        siteId: SITE_A.id,
        dayType: "weekday",
        origins: ["default"],
      }),
    );
    expect(records[0]!.evaluation.result.sites[0].monthlyRevenueUsd).toEqual(
      original.evaluation.result.sites[0].monthlyRevenueUsd,
    );
    expect(records[1]!.evaluation.request).toEqual({
      ...records[0]!.evaluation.request,
      sites: [
        {
          ...records[0]!.evaluation.request.sites[0],
          config: {
            ...records[0]!.evaluation.request.sites[0].config,
            stations: { ...config.stations, planned: 2 },
            staff: { ...config.staff, headcount: 2 },
          },
        },
      ],
    });
    expect(await s.comparisons.load("p", "source")).toEqual(original);
    const weekend = await s.service.get("p", {
      ...s.input,
      dayType: "weekend",
    });
    expect(weekend.configurations.map((c) => c.runId)).toEqual(
      final.configurations.map((c) => c.runId),
    );
    expect(
      (await s.service.post("p", { ...s.input, configurationId: "baseline" }))
        .status,
    ).toBe("ready");
    expect(s.evaluate).toHaveBeenCalledTimes(3);
  });
  it("uses the real runner budget and requires explicit per-configuration confirmation", async () => {
    const s = await setup(3);
    const denied = await s.service.post("p", {
      ...s.input,
      configurationId: "baseline",
    });
    expect(denied.status).toBe("needs_confirmation");
    expect(denied.confirmation).toEqual({
      configurationId: "baseline",
      costUnits: 4,
      remainingUnits: 3,
    });
    expect(s.evaluate).not.toHaveBeenCalled();
    const accepted = await s.service.post("p", {
      ...s.input,
      configurationId: "baseline",
      confirm: true,
    });
    expect(accepted.configurations[0].status).toBe("succeeded");
    expect(
      (await s.service.post("p", { ...s.input, configurationId: "plus-one" }))
        .status,
    ).toBe("needs_confirmation");
    expect(s.evaluate).toHaveBeenCalledTimes(1);
  });
  it("uses snapshot preparation for generic resume and never silently assembles station scenarios", async () => {
    const s = await setup();
    const plan = await s.service.post("p", {
      ...s.input,
      configurationId: "baseline",
    });
    const scenario = s.rows.get(plan.configurations[0].scenarioId)!;
    const prepared = await prepareStationExperimentScenario(
      { comparisons: s.comparisons },
      scenario,
      "huff",
    );
    expect(prepared?.request.seedSet).toEqual([11, 22]);
    expect(prepared?.request.sites).toHaveLength(1);
    expect(prepared?.scenario?.id).toBe(scenario.id);
    expect(
      await prepareStationExperimentScenario(
        { comparisons: s.comparisons },
        { ...scenario, overrides: {} },
        "huff",
      ),
    ).toBeNull();
    await expect(
      prepareStationExperimentScenario(
        { comparisons: s.comparisons },
        { ...scenario, label: "tampered" },
        "huff",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });
  it("rejects cross-project source, tampered identity and cap-clamped candidates without runs", async () => {
    const s = await setup();
    await expect(s.service.get("other", s.input)).rejects.toMatchObject({
      code: "not_found",
    });
    const bad = structuredClone(s.source);
    bad.evaluation.result.profileId = "wrong";
    await s.comparisons.save(bad);
    expect((await s.service.get("p", s.input)).status).toBe("unavailable");
    expect(s.evaluate).not.toHaveBeenCalled();
    const capped = structuredClone(s.source);
    capped.evaluation.request.sites[0].config.stations.usableSf = 250;
    const req = capped.evaluation.request;
    await s.comparisons.save(
      buildStoredComparison("source", req, evaluateSites(req)),
    );
    const plan = await s.service.get("p", s.input);
    expect(plan.status).toBe("unavailable");
    expect(plan.configurations).toEqual([]);
  });
});

it("preserves the original global Huff fallback when narrowing a Jev request", async () => {
  const s = await setup();
  const request = structuredClone(s.source.evaluation.request);
  request.demandSource = "jev";
  request.sites[0].behaviorTable = makeBehaviorTable(SITE_A.id);
  const source = buildStoredComparison(
    "source",
    request,
    evaluateSites(request),
  );
  await s.comparisons.save(source);
  const done = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  expect(done.source).toMatchObject({
    demandSource: "huff",
    sourceNotice: "Uses saved Huff fallback",
  });
  const record = await s.comparisons.load(
    "p",
    done.configurations[0].comparisonId!,
  );
  expect(record!.evaluation.request.demandSource).toBe("huff");
  expect(record!.evaluation.request.sites[0].behaviorTable).toEqual(
    request.sites[0].behaviorTable,
  );
  expect(record!.evaluation.result.sites[0].monthlyRevenueUsd).toEqual(
    source.evaluation.result.sites[0].monthlyRevenueUsd,
  );
});
it("retains partial work and safely resumes transient evaluation failure", async () => {
  const s = await setup();
  s.evaluate.mockRejectedValueOnce(new Error("temporary storage"));
  await expect(
    s.service.post("p", { ...s.input, configurationId: "baseline" }),
  ).rejects.toThrow("temporary storage");
  expect((await s.service.get("p", s.input)).configurations[0].status).toBe(
    "running",
  );
  expect(
    (await s.service.post("p", { ...s.input, configurationId: "baseline" }))
      .configurations[0].status,
  ).toBe("succeeded");
  expect(s.evaluate).toHaveBeenCalledTimes(2);
});
it("generic runner advance delegates station jobs to snapshots even before request exists", async () => {
  const s = await setup(0);
  const denied = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  const c = denied.configurations[0];
  const scenario = s.rows.get(c.scenarioId)!;
  await s.executions.reserve({
    id: c.runId,
    projectId: "p",
    scenarioId: c.scenarioId,
    idempotencyKey: c.runId,
    effectiveKey: (await import("@/lib/scenario/run")).scenarioExecutionKey(
      scenario,
      "huff",
    ),
    costUnits: 4,
    budgetUnits: 0,
    confirm: true,
    now: new Date(),
  });
  const freshAssembly = vi.fn(async () => {
    throw new Error("Fresh assembly forbidden");
  });
  const prepare = withStationExperimentSnapshots({
    comparisons: s.comparisons,
    prepare: freshAssembly,
  });
  const original = s.comparisons.load.bind(s.comparisons);
  let fail = true;
  s.comparisons.load = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error("snapshot unavailable");
    }
    return original(...args);
  };
  const runner = createScenarioRunner({
    scenarios: s.scenarios,
    executions: s.executions,
    comparisons: s.comparisons,
    prepare,
    newId: () => crypto.randomUUID(),
  });
  await expect(runner.advance("p", c.scenarioId, c.runId)).rejects.toThrow(
    "snapshot unavailable",
  );
  expect((await s.executions.get("p", c.runId))!.request).toBeNull();
  expect((await runner.advance("p", c.scenarioId, c.runId)).status).toBe(
    "succeeded",
  );
  expect(freshAssembly).not.toHaveBeenCalled();
});
it("reads unknown or stale freshness honestly and suppresses owned immutable layouts", async () => {
  const s = await setup();
  s.comparisons.profileVersions.p = 2;
  expect((await s.service.get("p", s.input)).source).toMatchObject({
    currentProfileVersion: 2,
    outdated: true,
  });
  s.comparisons.currentProfileVersion = async () => {
    throw new Error("offline");
  };
  expect((await s.service.get("p", s.input)).source).toMatchObject({
    currentProfileVersion: null,
    outdated: null,
  });
  s.source.evaluation.assembly = {
    assumptions: {},
    findings: [],
    scenario: {
      id: "source-scenario",
      layoutId: "layout",
      layout: null,
      overrides: {},
    },
  };
  await s.comparisons.save(s.source);
  expect((await s.service.get("p", s.input)).unavailable?.code).toBe(
    "immutable_layout",
  );
  expect(s.evaluate).not.toHaveBeenCalled();
});

it("reuses a validated completed equivalent run at zero cost", async () => {
  const s = await setup(0);
  const denied = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  const c = denied.configurations[0],
    scenario = s.rows.get(c.scenarioId)!;
  const other = { ...scenario, id: "equivalent-station-scenario" };
  // Cache identity is determined by inputs rather than the incidental scenario ID.
  s.rows.set(other.id, other);
  // The prepared snapshot must describe the actually reserved immutable scenario.
  const priming = createScenarioRunner({
    scenarios: s.scenarios,
    executions: s.executions,
    comparisons: s.comparisons,
    newId: () => crypto.randomUUID(),
    prepare: async () => {
      const snapshot = (await prepareStationExperimentScenario(
        { comparisons: s.comparisons },
        scenario,
        "huff",
      ))!;
      return { ...snapshot, scenario: { ...snapshot.scenario!, id: other.id } };
    },
  });
  expect(
    (await priming.start("p", other.id, { demandSource: "huff" })).status,
  ).toBe("succeeded");
  const cached = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  expect(cached.configurations[0]).toMatchObject({
    status: "succeeded",
    cached: true,
    costUnits: 0,
  });
  expect(s.evaluate).not.toHaveBeenCalled();
});

it("rejects modified deterministic scenario or saved execution instead of reusing it", async () => {
  const s = await setup(0);
  const plan = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  const c = plan.configurations[0],
    scenario = s.rows.get(c.scenarioId)!;
  s.rows.set(c.scenarioId, { ...scenario, overrides: {} });
  await expect(
    s.service.post("p", { ...s.input, configurationId: "baseline" }),
  ).rejects.toMatchObject({ code: "invalid" });
  s.rows.set(c.scenarioId, scenario);
  const realGet = s.executions.get.bind(s.executions);
  await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
    confirm: true,
  });
  s.executions.get = async (...args) => {
    const job = await realGet(...args);
    return job ? { ...job, effectiveKey: "tampered" } : null;
  };
  await expect(s.service.get("p", s.input)).rejects.toMatchObject({
    code: "invalid",
  });
});

it("reloads and validates the winning scenario after an insertion race", async () => {
  const s = await setup();
  s.scenarios.insert.mockImplementationOnce(async (scenario) => {
    s.rows.set(scenario.id, structuredClone(scenario));
    throw new Error("unique violation after concurrent insert");
  });
  const done = await s.service.post("p", {
    ...s.input,
    configurationId: "baseline",
  });
  expect(done.configurations[0].status).toBe("succeeded");
  expect(s.rows.size).toBe(1);
});

it("GET never backfills old retained results with missing helper artifacts", async () => {
  const s = await setup();
  for (const configurationId of ["baseline", "plus-one", "plus-two"])
    await s.service.post("p", { ...s.input, configurationId });
  const ready = await s.service.get("p", s.input);
  const record = (await s.comparisons.load(
    "p",
    ready.configurations[0].comparisonId!,
  ))!;
  delete record.evaluation.result.sites[0].stationObservations;
  await s.comparisons.save(record);
  s.evaluate.mockClear();
  const legacy = await s.service.get("p", s.input);
  expect(legacy).toMatchObject({
    status: "unavailable",
    unavailable: { code: "missing_observations" },
  });
  expect(s.evaluate).not.toHaveBeenCalled();
});

it("returns no callout when explicit variants change no customer outcome", async () => {
  const s = await setup();
  const request = structuredClone(s.source.evaluation.request);
  request.personaSet.personas = request.personaSet.personas.map((persona) => ({
    ...persona,
    weight: 0,
  }));
  await s.comparisons.save(
    buildStoredComparison("source", request, evaluateSites(request)),
  );
  for (const configurationId of ["baseline", "plus-one", "plus-two"])
    await s.service.post("p", { ...s.input, configurationId });
  expect((await s.service.get("p", s.input)).result).toMatchObject({
    status: "available",
    selected: null,
    variants: [],
  });
});

it("retains recorded selected-site and global input origins alongside proposal default", async () => {
  const s = await setup();
  s.source.evaluation.assembly = {
    findings: [],
    assumptions: {
      "profile.averageTicketCents": {
        value: 800,
        origin: "founder",
        evidenceIds: ["profile"],
      },
      [`sites.${SITE_A.id}.sizeSqft`]: {
        value: 1200,
        origin: "costar",
        evidenceIds: ["listing"],
      },
      [`sites.${SITE_B.id}.sizeSqft`]: {
        value: 1200,
        origin: "public",
        evidenceIds: ["unrelated-site"],
      },
      "category.squareFeetPerStation": {
        value: 250,
        origin: "default",
        evidenceIds: ["category"],
      },
    },
  };
  await s.comparisons.save(s.source);
  for (const configurationId of ["baseline", "plus-one", "plus-two"])
    await s.service.post("p", { ...s.input, configurationId });
  const result = (await s.service.get("p", s.input)).result;
  if (result?.status !== "available")
    throw new Error("Expected completed variants");
  expect(result.variants.length).toBeGreaterThan(0);
  for (const variant of result.variants)
    expect(variant.origins).toEqual(["default", "founder", "costar"]);
});
