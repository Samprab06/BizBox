import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import {
  COMPETITORS,
  FIXTURE_PERSONA_SET,
  SITE_A,
  makeBehaviorTable,
} from "@/lib/demand/fixtures";
import {
  EvaluationRequestSchema,
  type EvaluationRequest,
  type EvaluationRequestInput,
} from "@/lib/contracts/evaluation";
import { CopilotReadResultSchema } from "@/lib/contracts/copilot-read-tools";
import type { Scenario } from "@/lib/contracts/scenario";
import { evaluateSites } from "@/lib/evaluation/evaluate";
import {
  buildStoredComparison,
  type StoredComparison,
} from "@/lib/evaluation/store";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";
import { deriveScenario } from "@/lib/scenario/model";
import { buildScenarioPatch } from "@/lib/scenario/patch";
import { createScenarioPreparer } from "@/lib/scenario/prepare";
import { createScenarioService } from "@/lib/scenario/service";
import type { ScenarioRepository } from "@/lib/scenario/repository";
import { createCopilotMutationTools } from "./copilot-tools";
import { createCopilotReadTools } from "./copilot-read-tools";
import { resolveCopilotReference } from "./copilot-references";
import {
  assessExperiment,
  diagnose,
  DiagnosisScopeError,
  experimentMatches,
  experimentWinners,
  segmentShares,
} from "./diagnose";

const PROJECT = "p1";
const signal = new AbortController().signal;

function config(stations: number, rent: number) {
  return {
    hours: {
      weekday: { openMin: 360, closeMin: 1080 },
      weekend: { openMin: 360, closeMin: 1080 },
    },
    stations: { planned: stations, usableSf: 1800, sfPerStation: 300 },
    prices: { avgTicketUsd: 6.5 },
    staff: { headcount: 2, wageUsdPerHour: 16 },
    costs: { cogsPctOfRevenue: 0.28 },
    lease: {
      sf: 1800,
      askingRentUsdPerSfYear: rent,
      tripleNet: false,
      buildoutUsd: 30000,
      leaseTermMonths: 60,
    },
    calendar: { weekdayDaysPerMonth: 21.7, weekendDaysPerMonth: 8.7 },
  };
}

/** One Houston coffee site through the real demand model and queue engine. */
function baseRequest(
  stations: number,
  rent: number,
  extra: Partial<EvaluationRequestInput> = {},
): EvaluationRequest {
  return EvaluationRequestSchema.parse({
    projectId: PROJECT,
    profileId: "profile-v1",
    profileVersion: 1,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    competitors: COMPETITORS,
    demandSource: "huff",
    seeds: 6,
    sites: [
      { siteId: SITE_A.id, storefront: SITE_A, config: config(stations, rent) },
    ],
    ...extra,
  });
}

/** In-memory scenario history, the real preparer and the real evaluation. */
function workspace(request: EvaluationRequest) {
  const rows = new Map<string, Scenario>();
  const repository = {
    async insert(s: Scenario) {
      rows.set(s.id, s);
      return s;
    },
    async get(projectId: string, id: string) {
      const row = rows.get(id);
      return row?.projectId === projectId ? row : null;
    },
    async list(projectId: string) {
      return [...rows.values()].filter((s) => s.projectId === projectId);
    },
    async appendVersion(projectId, parentId, changes, meta) {
      const parent = await this.get(projectId, parentId);
      if (!parent) throw new Error("missing parent");
      return this.insert(deriveScenario(parent, changes, meta));
    },
  } satisfies Pick<
    ScenarioRepository,
    "insert" | "get" | "list" | "appendVersion"
  >;
  let next = 0;
  const service = createScenarioService({
    repository,
    newId: () => `scenario-${++next}`,
    now: () => new Date("2026-11-14T17:00:00.000Z"),
  });
  const prepare = createScenarioPreparer({
    loadProfile: async () => ({
      ...syntheticHoustonFixture.profile,
      projectId: PROJECT,
      id: "profile-v1",
      version: 1,
    }),
    loadLayout: async () => null,
    assemble: async () => ({
      request: structuredClone(request),
      findings: [],
      assumptions: {} as AssemblyMetadata["assumptions"],
    }),
  });
  const comparisons = new Map<string, StoredComparison>();
  /** Stands in for a human-approved run: prepare, evaluate and save the comparison. */
  async function run(scenario: Scenario) {
    const prepared = await prepare(scenario, request.demandSource);
    const record = buildStoredComparison(
      `c-${scenario.id}`,
      prepared.request,
      evaluateSites(prepared.request),
    );
    record.evaluation.assembly = {
      scenario: prepared.scenario,
      findings: [],
      assumptions: prepared.assumptions,
    };
    comparisons.set(scenario.id, record);
    return record;
  }
  const mutations = createCopilotMutationTools({
    scenarios: service,
    stationCapacity: async (_projectId, scenario) =>
      scenario.siteIds.map((siteId) => ({
        siteId,
        maxStations: 6,
        layoutId: null,
        evidenceIds: [`listing:${siteId}:usableSf`],
      })),
  });
  const reads = createCopilotReadTools({
    scenarios: service,
    comparisonForScenario: async (_projectId, scenarioId) =>
      comparisons.get(scenarioId) ?? null,
  });
  const root = () =>
    service.create(PROJECT, {
      siteIds: [SITE_A.id],
      profileVersion: 1,
      label: "Baseline",
      author: "founder",
    });
  return { service, run, mutations, reads, root, comparisons };
}

function resolve(
  record: StoredComparison,
  scenarios: Scenario[],
  refs: unknown[],
) {
  return refs.map(
    (reference) =>
      resolveCopilotReference({
        reference,
        issuedReferences: refs,
        projectId: PROJECT,
        scenarios,
        comparisons: [record],
      }).value,
  );
}

describe("diagnose", () => {
  it("classifies a one-station fixture as capacity-limited, citing run IDs and hour blocks", async () => {
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    const record = await w.run(base);
    const diagnosis = diagnose(base, record);
    const capacity = diagnosis.findings.filter(
      (f) => f.bottleneck === "capacity_limited",
    );
    expect(capacity.length).toBeGreaterThan(0);
    expect(diagnosis.findings.map((f) => f.bottleneck)).not.toContain(
      "rent_limited",
    );
    const runIds = new Set(record.runs.map((run) => run.id));
    for (const finding of diagnosis.findings) {
      expect(finding.runIds.length).toBeGreaterThan(0);
      expect(finding.runIds.every((id) => runIds.has(id))).toBe(true);
      expect(finding.hourBlocks.length).toBeGreaterThan(0);
      for (const block of finding.hourBlocks) {
        expect(finding.runIds).toContain(block.runId);
        expect(block.startHour).toBeGreaterThanOrEqual(6);
        expect(block.endHour).toBeLessThanOrEqual(18);
      }
      // No numeric prose: numbers resolve through issued references only.
      expect(finding.summary).not.toMatch(/\d/);
      const values = resolve(record, [base], finding.references);
      expect(values.every((v) => v !== undefined && v !== null)).toBe(true);
    }
    // Each cited hour really is saturated and losing customers in the saved run.
    const weekday = record.evaluation.result.sites[0].representative.weekday;
    const block = capacity.find((f) => f.hourBlocks[0].day === "weekday")!
      .hourBlocks[0];
    expect(block.runId).toBe(weekday.runId);
    for (const hour of weekday.hourly.filter(
      (h) => h.hour >= block.startHour && h.hour < block.endHour,
    )) {
      expect(hour.utilization).toBeGreaterThanOrEqual(0.85);
      expect(hour.abandoned).toBeGreaterThanOrEqual(2);
    }
    expect(diagnosis.warnings).toEqual([
      "REPRESENTATIVE_RUN_ONLY",
      "HUFF_FALLBACK_DEMAND",
    ]);
  });

  it("proposes a station experiment that, once the human runs it, reduces walk-aways", async () => {
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    const baseRecord = await w.run(base);
    const diagnosis = diagnose(base, baseRecord);
    expect(diagnosis.experiments.length).toBeGreaterThan(0);
    expect(diagnosis.experiments.length).toBeLessThanOrEqual(3);
    const experiment = diagnosis.experiments[0];
    expect(experiment).toMatchObject({
      tool: "set_stations",
      args: { scenario_id: base.id, n: 2 },
      requiresRun: true,
      expectedEffect: {
        siteId: SITE_A.id,
        metric: "weekdayAbandonmentRate",
        direction: "decrease",
      },
    });
    // Agent path: the existing mutation tool creates a pending child; nothing runs.
    const created = await w.mutations.execute("set_stations", experiment.args, {
      projectId: PROJECT,
      evidenceId: "copilot:turn:call",
      signal,
      scenarioId: base.id,
      profileVersion: 1,
    });
    expect(created.status).toBe("created");
    expect(w.comparisons.size).toBe(1);
    const child = await w.service.get(
      PROJECT,
      (created as { scenarioId: string }).scenarioId,
    );
    expect(experimentMatches(experiment, base, child)).toBe(true);
    // The human chooses Run; then the diff card compares the saved results.
    const childRecord = await w.run(child);
    const card = assessExperiment({
      parent: base,
      parentComparison: baseRecord,
      child,
      childComparison: childRecord,
    });
    expect(card).toMatchObject({
      experimentId: experiment.id,
      verdict: "improved",
      winner: true,
      metric: "weekdayAbandonmentRate",
    });
    expect(experimentWinners([card])).toEqual([card]);
    const [delta] = card.references.map(
      (reference) =>
        resolveCopilotReference({
          reference,
          issuedReferences: card.references,
          projectId: PROJECT,
          scenarios: [base, child],
          comparisons: [baseRecord, childRecord],
        }).value as number,
    );
    expect(delta).toBeLessThan(0);
    const before = baseRecord.evaluation.result.sites[0];
    const after = childRecord.evaluation.result.sites[0];
    expect(after.representative.weekday.abandoned).toBeLessThan(
      before.representative.weekday.abandoned,
    );
  });

  it("matches an equivalent manual change: same simulation, same experiment, same verdict", async () => {
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    const baseRecord = await w.run(base);
    const [experiment] = diagnose(base, baseRecord).experiments;
    const created = await w.mutations.execute("set_stations", experiment.args, {
      projectId: PROJECT,
      evidenceId: "copilot:turn:call",
      signal,
    });
    const agent = await w.service.get(
      PROJECT,
      (created as { scenarioId: string }).scenarioId,
    );
    const manual = await w.service.create(PROJECT, {
      fromId: base.id,
      patch: buildScenarioPatch(
        base,
        { kind: "stations", count: 2 },
        { origin: "founder", evidenceIds: ["founder:lever"] },
      ),
      author: "founder",
    });
    expect(manual.author).toBe("founder");
    expect(agent.author).toBe("agent");
    const agentRecord = await w.run(agent);
    const manualRecord = await w.run(manual);
    expect(manualRecord.evaluation.request.sites).toEqual(
      agentRecord.evaluation.request.sites,
    );
    // Run and event IDs embed the comparison ID; everything else is identical.
    const anonymous = (record: StoredComparison) =>
      JSON.stringify(record.evaluation.result.sites).replaceAll(record.id, "c");
    expect(anonymous(manualRecord)).toBe(anonymous(agentRecord));
    const cards = [agent, manual].map((child) =>
      assessExperiment({
        parent: base,
        parentComparison: baseRecord,
        child,
        childComparison: w.comparisons.get(child.id)!,
      }),
    );
    expect(cards[0].experimentId).toBe(experiment.id);
    expect(cards[1].experimentId).toBe(experiment.id);
    expect(cards[1].verdict).toBe(cards[0].verdict);
  });

  it("rejects stale results: wrong scenario version, wrong parent or swapped comparisons", async () => {
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    const baseRecord = await w.run(base);
    const child = await w.service.create(PROJECT, {
      fromId: base.id,
      patch: buildScenarioPatch(
        base,
        { kind: "stations", count: 2 },
        { origin: "founder", evidenceIds: ["founder:lever"] },
      ),
      author: "founder",
    });
    const childRecord = await w.run(child);
    expect(() => diagnose(child, baseRecord)).toThrow(DiagnosisScopeError);
    expect(() => diagnose({ ...base, profileVersion: 2 }, baseRecord)).toThrow(
      DiagnosisScopeError,
    );
    const grandchild = await w.service.create(PROJECT, {
      fromId: child.id,
      patch: { label: "Later" },
      author: "founder",
    });
    const grandRecord = await w.run(grandchild);
    expect(() =>
      assessExperiment({
        parent: base,
        parentComparison: baseRecord,
        child: grandchild,
        childComparison: grandRecord,
      }),
    ).toThrow(DiagnosisScopeError);
    expect(() =>
      assessExperiment({
        parent: base,
        parentComparison: baseRecord,
        child,
        childComparison: baseRecord,
      }),
    ).toThrow(DiagnosisScopeError);
    expect(() =>
      assessExperiment({
        parent: base,
        parentComparison: childRecord,
        child,
        childComparison: childRecord,
      }),
    ).toThrow(DiagnosisScopeError);
  });

  it("classifies a low-demand fixture as demand-limited and a high-rent fixture as rent-limited", async () => {
    const demand = workspace(
      baseRequest(4, 30, { overrides: { scaleMultiplier: 0.3 } }),
    );
    const quiet = await demand.root();
    const quietRecord = await demand.run(quiet);
    const idle = diagnose(quiet, quietRecord);
    expect(idle.findings.map((f) => f.bottleneck)).toContain("demand_limited");
    expect(idle.findings.map((f) => f.bottleneck)).not.toContain(
      "capacity_limited",
    );
    for (const finding of idle.findings.filter(
      (f) => f.bottleneck === "demand_limited",
    ))
      expect(
        resolve(quietRecord, [quiet], finding.references).every(
          (v) => v !== undefined,
        ),
      ).toBe(true);

    const rent = workspace(baseRequest(2, 400));
    const pricey = await rent.root();
    const priceyRecord = await rent.run(pricey);
    const costly = diagnose(pricey, priceyRecord);
    const finding = costly.findings.find(
      (f) => f.bottleneck === "rent_limited",
    );
    expect(finding).toBeDefined();
    expect(finding!.runIds).toHaveLength(2);
    expect(finding!.hourBlocks.map((b) => b.day)).toEqual([
      "weekday",
      "weekend",
    ]);
    const [contribution] = resolve(priceyRecord, [pricey], finding!.references);
    expect(contribution as number).toBeLessThan(0);
    expect(costly.experiments).toContainEqual(
      expect.objectContaining({
        tool: "find_sites",
        requiresRun: false,
        findingIds: [finding!.id],
        args: {
          scenario_id: pricey.id,
          preferences: { rentCeilingCents: 5_999_999 },
        },
      }),
    );
  });

  it("proposes at most three distinct experiments, including trimming idle edge hours", async () => {
    const w = workspace(baseRequest(2, 30));
    const base = await w.root();
    const diagnosis = diagnose(base, await w.run(base));
    expect(diagnosis.experiments.length).toBeLessThanOrEqual(3);
    expect(diagnosis.experiments[0]).toMatchObject({
      tool: "set_stations",
      args: { n: 3 },
    });
    const hours = diagnosis.experiments.find((e) => e.tool === "set_hours");
    expect(hours).toMatchObject({
      args: { scenario_id: base.id, open: 360, close: 1020 },
      requiresRun: true,
    });
    const ids = diagnosis.findings.map((f) => f.id);
    for (const experiment of diagnosis.experiments)
      expect(experiment.findingIds.every((id) => ids.includes(id))).toBe(true);
  });

  it("reports competitor leakage from cached Jev answers with resolvable segment shares", async () => {
    const request = baseRequest(2, 30, {
      demandSource: "jev",
      sites: [
        {
          siteId: SITE_A.id,
          storefront: SITE_A,
          config: config(2, 30),
          behaviorTable: makeBehaviorTable(SITE_A.id),
        },
      ],
    });
    const w = workspace(request);
    const base = await w.root();
    const record = await w.run(base);
    const diagnosis = diagnose(base, record);
    expect(diagnosis.demandSource).toBe("jev");
    const leak = diagnosis.findings.find(
      (f) => f.bottleneck === "competitor_leakage",
    );
    expect(leak).toMatchObject({ competitorId: "comp-x" });
    const [own, competitor] = resolve(
      record,
      [base],
      leak!.references,
    ) as number[];
    expect(competitor).toBeGreaterThan(own);
    const shares = segmentShares(record.evaluation.request, SITE_A.id, "jev");
    expect(
      shares.find((s) => s.segment === leak!.segment)?.shares["comp-x"],
    ).toBe(competitor);
  });
});

describe("diagnose read tool", () => {
  it("returns grounded findings and a diff card for a run child, without running anything", async () => {
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    await w.run(base);
    const context = {
      projectId: PROJECT,
      evidenceId: "copilot:turn:call",
      signal,
      scenarioId: base.id,
      profileVersion: 1,
    };
    const output = CopilotReadResultSchema.parse(
      await w.reads.execute("diagnose", { scenario_id: base.id }, context),
    );
    expect(output.status).toBe("diagnosed");
    if (output.status !== "diagnosed") return;
    expect(output.experimentCard).toBeUndefined();
    expect(JSON.stringify(output)).not.toMatch(/"(?:value|mean|low|high)":/);
    const created = await w.mutations.execute(
      "set_stations",
      output.experiments[0].args,
      context,
    );
    const childId = (created as { scenarioId: string }).scenarioId;
    // No saved run yet for the proposal: the diagnosis is not available.
    expect(
      await w.reads.execute(
        "diagnose",
        { scenario_id: childId },
        { ...context, scenarioId: childId },
      ),
    ).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    await w.run(await w.service.get(PROJECT, childId));
    const child = CopilotReadResultSchema.parse(
      await w.reads.execute(
        "diagnose",
        { scenario_id: childId },
        { ...context, scenarioId: childId },
      ),
    );
    expect(child).toMatchObject({
      status: "diagnosed",
      experimentCard: { verdict: "improved", winner: true },
    });
    // The workspace moved on: a stale snapshot cannot read the child.
    expect(
      await w.reads.execute("diagnose", { scenario_id: childId }, context),
    ).toMatchObject({ status: "rejected", code: "STALE_CONTEXT" });
  });

  it("never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const w = workspace(baseRequest(1, 30));
    const base = await w.root();
    diagnose(base, await w.run(base));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
