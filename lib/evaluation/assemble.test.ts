import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type { AssumedValue } from "@/lib/contracts";
import { searchSites } from "@/lib/data/sites";
import { buildCatchment } from "@/lib/data/catchments";
import { MemoryJevCache } from "@/lib/panel/cache";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import { weightTotals } from "@/lib/panel/personas";
import { evaluateSites } from "./evaluate";
import {
  assembleEvaluation,
  assembleEvaluationRequest,
  AssemblyError,
  AssemblyShortcutSchema,
  PanelInProgressError,
  type AssembleEvaluationInput,
  type AssemblyDependencies,
} from "./assemble";

const metric = (
  value: number | null,
  origin: AssumedValue["origin"] = "founder",
): AssumedValue => ({
  value,
  origin,
  unit: "test",
  evidenceIds: ["test"],
  ...(value === null ? { unknownReason: "Unknown" } : {}),
});
function input(): AssembleEvaluationInput {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  profile.projectId = "test-project";
  profile.id = "test-profile";
  for (const f of Object.values(profile.mustHaves)) f.value = false;
  return {
    projectId: profile.projectId,
    profileId: profile.id,
    profileVersion: profile.version,
    profile,
    candidateIds: ["101:1", "102:2", "103:3"],
    seeds: 1,
  };
}
function dependencies(raw = input()): AssemblyDependencies {
  const ids = raw.candidateIds;
  const source = {
    origin: "costar" as const,
    dataset: "Synthetic test inventory",
    recordId: "1",
    field: "test",
  };
  return {
    searchSites: vi.fn(async (profile) => ({
      result: searchSites(
        { profile, limit: 8 },
        {
          properties: ids.map((_, index) => ({
            id: String(index + 1),
            city: "Houston",
            latitude: 29.76 + index * 0.001,
            longitude: -95.37,
            data: { propertyRetail: { frontage: [{ frontageInFeet: 25 }] } },
            source,
          })),
          spaces: ids.map((id, index) => ({
            id,
            propertyId: String(index + 1),
            listingId: id.split(":")[0]!,
            active: true,
            retail: true,
            sizeSqFt: 1200 + index * 100,
            data: {
              spaceUse: "Retail",
              position: "Corner",
              floor: "Ground",
              askingRentUsdPerSfYearLow: 24 + index,
              askingRentUsdPerSfYearHigh: 24 + index,
              serviceTypeName: index === 1 ? "TripleNet" : "FullService",
            },
            source,
          })),
          tenancies: [],
          synthetic: true,
        },
      ),
      frontageFt: Object.fromEntries(
        ids.map((id) => [id, metric(25, "costar")]),
      ),
    })),
    getCatchment: vi.fn(async (id) => ({
      response: buildCatchment({
        site: {
          id,
          propertyId: "1",
          projectId: raw.projectId,
          city: "Houston",
          latitude: 29.76,
          longitude: -95.37,
          frontage: [{ trafficCount: 15000 }],
          source: {},
        },
        radiusMeters: 1000,
        radiusOrigin: "default",
        category: "coffee",
        retrievedAt: "2026-11-14T00:00:00Z",
        residents: [
          {
            geoid: "bg",
            population: 100,
            households: 40,
            medianHouseholdIncome: 60000,
            ageBands: { "18-34": 30 },
            areaFraction: 1,
            source: {},
          },
        ],
        workers: [
          {
            geoid: "job",
            jobs: 20,
            latitude: 29.76,
            longitude: -95.37,
            source: {},
          },
        ],
        venues: [
          {
            id: "venue",
            name: "Synthetic coffee",
            category: "coffee",
            latitude: 29.761,
            longitude: -95.37,
            origin: "public",
            source: {},
          },
        ],
        coTenants: [],
      }),
      locations: {
        blockGroups: { bg: { lat: 29.76, lng: -95.37 } },
        workers: { job: { lat: 29.76, lng: -95.37 } },
        competitors: {
          "public:venue": {
            lat: 29.761,
            lng: -95.37,
            origin: "public" as const,
          },
        },
      },
    })),
  };
}

describe("evaluation assembly with injected source dependencies", () => {
  it("assembles three real-shaped IDs and evaluates a shared population with Huff", async () => {
    const raw = input();
    const deps = dependencies(raw);
    const assembled = await assembleEvaluation(raw, deps);
    expect(assembled.request.sites.map((s) => s.siteId)).toEqual(
      raw.candidateIds,
    );
    expect(assembled.request.demandSource).toBe("huff");
    expect(weightTotals(assembled.request.personaSet)).toEqual({
      resident: 100,
      worker: 20,
      passby: 0,
    });
    const evaluation = evaluateSites(assembled.request);
    expect(evaluation.result.ranking).toHaveLength(3);
    expect(new Set(evaluation.result.ranking)).toEqual(
      new Set(raw.candidateIds),
    );
    expect(
      assembled.findings.some((f) => f.code === "VEHICLES_NOT_PEOPLE"),
    ).toBe(true);
    expect(assembled.request.competitors).toHaveLength(1);
    expect(assembled.request.competitors[0]?.location).toEqual({
      lat: 29.761,
      lng: -95.37,
    });
  });
  it("converts dollars, NNN and station area without changing observed origins", async () => {
    const raw = input();
    const out = await assembleEvaluation(raw, dependencies(raw));
    const site = out.request.sites[1]!;
    expect(site.config.lease).toMatchObject({
      sf: 1300,
      askingRentUsdPerSfYear: expect.closeTo(25, 2),
      tripleNet: true,
      opexUsdPerSfYear: expect.closeTo(10, 2),
      buildoutUsd: 60000,
      leaseTermMonths: 60,
    });
    expect(site.config.stations).toEqual({
      planned: 13,
      usableSf: 1300,
      sfPerStation: 100,
    });
    expect(site.config.prices.avgTicketUsd).toBe(6.5);
    expect(out.assumptions["sites.102:2.monthlyBaseRentCents"]?.origin).toBe(
      "costar",
    );
    expect(out.assumptions["sites.102:2.monthlyOpexCents"]?.origin).toBe(
      "default",
    );
    expect(out.assumptions["sites.101:1.frontageFt"]?.origin).toBe("costar");
  });
  it("keeps explicit founder prices/wages/staff ahead of defaults", async () => {
    const raw = input();
    raw.profile.economics.averageTicketCents = metric(850);
    raw.profile.capacity.servers = metric(3);
    raw.profile.derivedDefaults.wageRateCentsPerHour = metric(2000);
    const out = await assembleEvaluation(raw, dependencies(raw));
    expect(out.request.sites[0]!.config).toMatchObject({
      prices: { avgTicketUsd: 8.5 },
      staff: { headcount: 3, wageUsdPerHour: 20 },
    });
    expect(out.assumptions["profile.averageTicketCents"]?.origin).toBe(
      "founder",
    );
  });
  it("uses sourced workplace earnings/age bands and marks only missing bands as defaults", async () => {
    const raw = input();
    const deps = dependencies(raw);
    const get = deps.getCatchment;
    deps.getCatchment = async (...args) => {
      const bundle = await get(...args);
      Object.assign(bundle.locations!.workers!.job!, {
        earnings: { low: 0, mid: 0, high: 20 },
        ages: { under30: 0, age30to54: 0, over55: 20 },
      });
      return bundle;
    };
    const out = await assembleEvaluation(raw, deps);
    expect(out.assumptions["personas.workers.job.earnings.high"]).toMatchObject(
      { value: 20, origin: "public" },
    );
    expect(out.assumptions["personas.workers.job.ages.over55"]).toMatchObject({
      value: 20,
      origin: "public",
    });
    const workers = out.request.personaSet.personas.filter(
      (p) => p.kind === "worker",
    );
    expect(workers.length).toBeGreaterThan(0);
    expect(workers.every((p) => p.incomeUsd >= 85000 && p.age >= 55)).toBe(
      true,
    );
    const fallback = await assembleEvaluation(raw, dependencies(raw));
    expect(
      fallback.assumptions["personas.workers.job.earnings.high"],
    ).toMatchObject({ value: 1, origin: "default" });
    expect(
      out.assumptions["sites.101:1.config.stations.usableSf"],
    ).toMatchObject({ value: 1200, origin: "default" });
  });
  it("builds an order-independent study area: reversing candidates leaves every site's result unchanged (HAC-60)", async () => {
    /** Each site sees its own block group and workplace plus one shared block group whose
     * allocated population differs by site, as overlapping rings would. */
    const siteSpecific = (raw: AssembleEvaluationInput) => {
      const deps = dependencies(raw);
      const get = deps.getCatchment;
      deps.getCatchment = async (...args) => {
        const [id] = args;
        const bundle = await get(...args);
        const n = Number(String(id).split(":")[0]) - 100;
        const [bg] = bundle.response.residents.blockGroups;
        const [job] = bundle.response.workers.blocks;
        const scaled = <T extends { value: number | null }>(
          v: T,
          k: number,
        ) => ({ ...v, value: (v.value ?? 0) * k });
        bundle.response.catchment = {
          ...bundle.response.catchment,
          id: `catchment-${id}`,
        };
        bundle.response.residents.blockGroups = [
          {
            ...bg!,
            geoid: `bg-${id}`,
            allocatedPopulation: scaled(bg!.allocatedPopulation, n),
          },
          {
            ...bg!,
            geoid: "bg-shared",
            allocatedPopulation: scaled(bg!.allocatedPopulation, 1 + n / 2),
          },
        ];
        bundle.response.workers.blocks = [
          { ...job!, geoid: `job-${id}`, jobs: scaled(job!.jobs, n) },
        ];
        bundle.locations = {
          ...bundle.locations,
          workers: { [`job-${id}`]: { lat: 29.76 + n * 0.002, lng: -95.37 } },
          blockGroups: {
            [`bg-${id}`]: { lat: 29.76 + n * 0.002, lng: -95.371 },
          },
        };
        return bundle;
      };
      return deps;
    };
    const forward = input();
    const reversed = {
      ...input(),
      candidateIds: [...forward.candidateIds].reverse(),
    };
    const a = await assembleEvaluation(forward, siteSpecific(forward));
    // Same inventory (the harness assigns rent/size by list position); only the request order differs.
    const b = await assembleEvaluation(reversed, siteSpecific(forward));
    // The population includes every candidate's block groups, not just the first site's.
    expect(a.request.personaSet).toEqual(b.request.personaSet);
    expect(a.request.personaSet.catchmentId).toMatch(/^study:/);
    expect(a.findings.map((f) => f.code)).toContain("SHARED_STUDY_AREA");
    const result = (x: typeof a) =>
      Object.fromEntries(
        evaluateSites(x.request).result.sites.map((s) => [
          s.siteId,
          s.monthlyContributionUsd,
        ]),
      );
    expect(result(b)).toEqual(result(a));
  });
  it("skips unknown rent or size with findings instead of fabricating values", async () => {
    const raw = input();
    const deps = dependencies(raw);
    const search = deps.searchSites;
    deps.searchSites = async (...args) => {
      const out = await search(...args);
      out.result.candidates[0]!.baseRentCents = metric(null, "costar");
      out.result.candidates[1]!.candidate.floorAreaSqFt = metric(
        null,
        "costar",
      );
      return out;
    };
    const out = await assembleEvaluation(raw, deps);
    expect(out.request.sites.map((s) => s.siteId)).toEqual(["103:3"]);
    expect(out.findings.filter((f) => f.code === "SITE_INPUT_UNKNOWN")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          siteId: "101:1",
          message: expect.stringContaining("rent"),
        }),
        expect.objectContaining({
          siteId: "102:2",
          message: expect.stringContaining("size"),
        }),
      ]),
    );
    expect(deps.getCatchment).toHaveBeenCalledTimes(1);
  });
  it("reports all excluded sites on AssemblyError when none can be evaluated", async () => {
    const raw = input();
    const deps = dependencies(raw);
    deps.searchSites = async () => ({
      result: {
        candidates: [],
        filters: [],
        mostRestrictiveFilter: null,
        emptyReason: null,
        totalMatched: 0,
        evidence: [],
        modelVersion: "site-prescore-v1",
      },
    });
    await expect(assembleEvaluation(raw, deps)).rejects.toMatchObject({
      findings: expect.arrayContaining(
        raw.candidateIds.map((siteId) =>
          expect.objectContaining({ siteId, code: "CANDIDATE_UNAVAILABLE" }),
        ),
      ),
    });
  });
  it("does not turn a missing buildout input into a free buildout", async () => {
    const raw = input();
    raw.profile.economics.buildoutBudgetCents = metric(null);
    await expect(
      assembleEvaluation(raw, dependencies(raw)),
    ).rejects.toBeInstanceOf(AssemblyError);
  });
  it("rejects cross-project or stale profile identity before reading sources", async () => {
    const raw = input();
    raw.profileVersion = 2;
    const deps = dependencies(raw);
    await expect(assembleEvaluation(raw, deps)).rejects.toThrow(/identity/);
    expect(deps.searchSites).not.toHaveBeenCalled();
    expect(
      AssemblyShortcutSchema.safeParse({
        projectId: "x",
        profileId: "p",
        candidateIds: ["1:2", "1:2"],
      }).success,
    ).toBe(false);
    expect(
      AssemblyShortcutSchema.safeParse({
        projectId: "x",
        profileId: "p",
        candidateIds: ["1%3A2"],
      }).success,
    ).toBe(false);
  });
  it("uses a transparent Huff fallback when Jev was requested without configured dependencies", async () => {
    const raw = input();
    raw.demandSource = "jev";
    const out = await assembleEvaluation(raw, dependencies(raw));
    expect(out.request.sites.every((s) => !s.behaviorTable)).toBe(true);
    expect(evaluateSites(out.request).result).toMatchObject({
      requestedDemandSource: "jev",
      demandSource: "huff",
      fallbackReason: expect.stringContaining("unavailable"),
    });
  });
  it("attaches mocked Jev tables and reuses the cache with no second model call", async () => {
    const raw = input();
    raw.candidateIds = ["101:1"];
    raw.demandSource = "jev";
    const deps = dependencies(raw);
    const client = fakeJevClient();
    deps.jev = { client, cache: new MemoryJevCache() };
    const first = await assembleEvaluation(raw, deps);
    const calls = client.calls;
    const second = await assembleEvaluation(raw, deps);
    expect(calls).toBeGreaterThan(0);
    expect(client.calls).toBe(calls);
    expect(second.request).toEqual(first.request);
    const table = first.request.sites[0]!.behaviorTable!;
    expect(table.siteId).toBe("101:1");
    expect(table.personas[0]!.where).toHaveProperty("101:1");
    expect(evaluateSites(first.request).result.demandSource).toBe("jev");
  });
  it("throws PanelInProgressError at the panel deadline, then resumes to the unbounded request (HAC-155)", async () => {
    const raw = input();
    raw.candidateIds = ["101:1"];
    raw.demandSource = "jev";
    const deps = dependencies(raw);
    const client = fakeJevClient();
    deps.jev = { client, cache: new MemoryJevCache() };
    let clock = 0;
    // Every call "takes" 1 s on this clock; the budget allows a handful per run.
    const ask = client.ask.bind(client);
    client.ask = async (req) => {
      clock += 1000;
      return ask(req);
    };
    const deadline = () => ({
      deadlineAt: clock + 8_000,
      deadlineReserveMs: 1_000,
      now: () => clock,
    });
    let error: unknown;
    try {
      await assembleEvaluation(raw, deps, deadline());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PanelInProgressError);
    const progress = error as PanelInProgressError;
    expect(progress.message).toMatch(
      /^Jev panel in progress \(\d+\/\d+ personas\)$/,
    );
    expect(progress.completedPersonas).toBeLessThan(progress.totalPersonas);
    let resumed: Awaited<ReturnType<typeof assembleEvaluation>> | undefined;
    for (let i = 0; i < 500 && !resumed; i++)
      resumed = await assembleEvaluation(raw, deps, deadline()).catch((e) => {
        if (e instanceof PanelInProgressError) return undefined;
        throw e;
      });
    const unbounded = await assembleEvaluation(raw, {
      ...dependencies(raw),
      jev: { client: fakeJevClient(), cache: new MemoryJevCache() },
    });
    expect(resumed?.request).toEqual(unbounded.request);
  });
  it("does not attach failed Jev tables that would silently remove the population", async () => {
    const raw = input();
    raw.candidateIds = ["101:1"];
    raw.demandSource = "jev";
    const deps = dependencies(raw);
    deps.jev = {
      client: fakeJevClient({ fail: () => true }),
      cache: new MemoryJevCache(),
    };
    const out = await assembleEvaluation(raw, deps);
    expect(out.request.sites[0]!.behaviorTable).toBeUndefined();
    expect(evaluateSites(out.request).result.demandSource).toBe("huff");
  });
  /** Fake Jev whose first-seen request fails `times` times, then answers. */
  function flakyJev(times: number) {
    const attempts = new Map<string, number>();
    let target: string | undefined;
    return fakeJevClient({
      fail: (req) => {
        const key = JSON.stringify(req);
        target ??= key;
        if (key !== target) return false;
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
        return attempts.get(key)! <= times;
      },
    });
  }
  it("retries a persona that fails once and still uses Jev for the site", async () => {
    const raw = input();
    raw.candidateIds = ["101:1"];
    raw.demandSource = "jev";
    const deps = dependencies(raw);
    deps.jev = { client: flakyJev(1), cache: new MemoryJevCache() };
    const out = await assembleEvaluation(raw, deps);
    const site = out.request.sites[0]!;
    expect(site.behaviorTable).toBeDefined();
    expect(site.jevPanel).toEqual({
      personaCount: out.request.personaSet.personas.length,
      failedPersonaCount: 0,
    });
    expect(out.findings.some((f) => f.code === "JEV_INCOMPLETE")).toBe(false);
    const result = evaluateSites(out.request).result;
    expect(result.demandSource).toBe("jev");
    expect(result.sites[0]!.jevPanel?.failedPersonaCount).toBe(0);
  });
  it("falls back to Huff and reports the failed persona count when a persona fails twice", async () => {
    const raw = input();
    raw.candidateIds = ["101:1"];
    raw.demandSource = "jev";
    const deps = dependencies(raw);
    deps.jev = { client: flakyJev(2), cache: new MemoryJevCache() };
    const out = await assembleEvaluation(raw, deps);
    const personaCount = out.request.personaSet.personas.length;
    const site = out.request.sites[0]!;
    expect(site.behaviorTable).toBeUndefined();
    expect(site.jevPanel).toEqual({ personaCount, failedPersonaCount: 1 });
    expect(out.findings).toContainEqual(
      expect.objectContaining({
        code: "JEV_INCOMPLETE",
        message: `Jev failed for 1 of ${personaCount} personas after one retry; all-site Huff fallback will be used.`,
      }),
    );
    const result = evaluateSites(out.request).result;
    expect(result.demandSource).toBe("huff");
    expect(result.sites[0]!.jevPanel).toEqual({
      personaCount,
      failedPersonaCount: 1,
    });
  });
  it("returns the canonical request from the simple public function", async () => {
    const raw = input();
    expect(await assembleEvaluationRequest(raw, dependencies(raw))).toEqual(
      (await assembleEvaluation(raw, dependencies(raw))).request,
    );
  });
});
