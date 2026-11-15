/**
 * HAC-159: each site's Jev personas come from that site's own catchment and are seeded by its
 * own catchment ID, so a site's full Jev request set (personas and competitors) and its cache
 * keys are identical whether it is evaluated alone or with other candidates. The union study
 * area (HAC-60) still drives the shared personas and Huff. Fake Jev only.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import {
  demandPersonaSet,
  EvaluationSiteSchema,
} from "@/lib/contracts/evaluation";
import { searchSites } from "@/lib/data/sites";
import { buildCatchment } from "@/lib/data/catchments";
import { MemoryJevCache, jevCacheKey } from "@/lib/panel/cache";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import type { JevAskRequest } from "@/lib/panel/jev-client";
import { evaluateSites } from "./evaluate";
import {
  assembleEvaluation,
  JEV_PERSONA_SET_VERSION,
  PanelInProgressError,
  type AssembleEvaluationInput,
  type AssemblyCatchment,
  type AssemblyDependencies,
} from "./assemble";

const optionId = (id: string) =>
  `s_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
const ALL = Array.from({ length: 8 }, (_, i) => `${101 + i}:${i + 1}`);
const TARGET = ALL[2]!;
const source = {
  origin: "costar" as const,
  dataset: "Synthetic test inventory",
  recordId: "1",
  field: "test",
};

function input(candidateIds: string[]): AssembleEvaluationInput {
  const profile = structuredClone(syntheticHoustonFixture.profile);
  profile.projectId = "test-project";
  profile.id = "test-profile";
  for (const f of Object.values(profile.mustHaves)) f.value = false;
  return {
    projectId: profile.projectId,
    profileId: profile.id,
    profileVersion: profile.version,
    profile,
    candidateIds,
    seeds: 1,
    demandSource: "jev",
  };
}

/**
 * Each site's catchment has its own block group and workplace plus a shared one, so the union
 * study area (and the personas built from it) changes with the set of candidates.
 */
function catchmentFor(id: string): AssemblyCatchment {
  const index = ALL.indexOf(id);
  const lat = 29.76 + index * 0.002;
  const venues = [
    {
      id: `venue-${index}`,
      name: `Coffee ${index}`,
      category: "coffee" as const,
      latitude: lat + 0.0005,
      longitude: -95.371,
      origin: "public" as const,
      source: {},
    },
  ];
  return {
    response: buildCatchment({
      site: {
        id,
        propertyId: String(index + 1),
        projectId: "test-project",
        city: "Houston",
        latitude: lat,
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
          geoid: "bg-shared",
          population: 400,
          households: 160,
          medianHouseholdIncome: 60000,
          ageBands: { "18-34": 30 },
          areaFraction: 1,
          source: {},
        },
        {
          geoid: `bg-${index}`,
          population: 300 + index * 50,
          households: 120,
          medianHouseholdIncome: 50000 + index * 5000,
          ageBands: { "18-34": 30 },
          areaFraction: 1,
          source: {},
        },
      ],
      workers: [
        {
          geoid: "job-shared",
          jobs: 200,
          latitude: 29.765,
          longitude: -95.37,
          source: {},
        },
        {
          geoid: `job-${index}`,
          jobs: 100 + index * 20,
          latitude: lat,
          longitude: -95.369,
          source: {},
        },
      ],
      venues,
      coTenants: [],
    }),
    locations: {
      blockGroups: {
        "bg-shared": { lat: 29.765, lng: -95.37 },
        [`bg-${index}`]: { lat: lat + 0.001, lng: -95.372 },
      },
      workers: {
        "job-shared": { lat: 29.765, lng: -95.37 },
        [`job-${index}`]: { lat, lng: -95.369 },
      },
      competitors: Object.fromEntries(
        venues.map((v) => [
          `public:${v.id}`,
          { lat: v.latitude, lng: v.longitude, origin: "public" as const },
        ]),
      ),
    },
  };
}

function dependencies(ids: string[]): AssemblyDependencies {
  return {
    searchSites: vi.fn(async (profile) => ({
      result: searchSites(
        { profile, limit: 8 },
        {
          properties: ids.map((id) => ({
            id: String(ALL.indexOf(id) + 1),
            city: "Houston",
            latitude: 29.76 + ALL.indexOf(id) * 0.002,
            longitude: -95.37,
            data: { propertyRetail: { frontage: [{ frontageInFeet: 25 }] } },
            source,
          })),
          spaces: ids.map((id) => ({
            id,
            propertyId: String(ALL.indexOf(id) + 1),
            listingId: id.split(":")[0]!,
            active: true,
            retail: true,
            sizeSqFt: 1200,
            data: {
              spaceUse: "Retail",
              position: "Corner",
              floor: "Ground",
              askingRentUsdPerSfYearLow: 24,
              askingRentUsdPerSfYearHigh: 24,
              serviceTypeName: "FullService",
            },
            source,
          })),
          tenancies: [],
          synthetic: true,
        },
      ),
    })),
    getCatchment: vi.fn(async (id) => catchmentFor(id)),
  };
}

/** A fake Jev that records every request it is sent. */
function recordingJev() {
  const client = fakeJevClient();
  const requests: JevAskRequest[] = [];
  const ask = client.ask.bind(client);
  client.ask = (req) => {
    requests.push(req);
    return ask(req);
  };
  return { client, requests };
}

const forSite = (requests: JevAskRequest[], siteId: string) =>
  requests
    .filter((r) => optionId(siteId) in r.state.options)
    .map((r) => JSON.stringify(r))
    .sort();

async function assemble(ids: string[], cache = new MemoryJevCache()) {
  const { client, requests } = recordingJev();
  const deps = dependencies(ids);
  deps.jev = { client, cache };
  const out = await assembleEvaluation(input(ids), deps);
  return { out, requests, client };
}

describe("candidate-independent Jev personas (HAC-159)", () => {
  it("a site's full Jev request set is byte-identical alone or with 7 other candidates", async () => {
    const alone = await assemble([TARGET]);
    const all = await assemble(ALL);
    const subset = await assemble([ALL[0]!, TARGET, ALL[7]!]);
    const target = forSite(alone.requests, TARGET);
    expect(target.length).toBeGreaterThan(0);
    expect(forSite(all.requests, TARGET)).toEqual(target);
    expect(forSite(subset.requests, TARGET)).toEqual(target);
    // Same requests, so the same cache keys.
    const keys = async (requests: JevAskRequest[]) =>
      (
        await Promise.all(
          requests
            .filter((r) => optionId(TARGET) in r.state.options)
            .map((r) => jevCacheKey(alone.client.modelVersion, r)),
        )
      ).sort();
    expect(await keys(all.requests)).toEqual(await keys(alone.requests));
    // Control: the shared study-area personas do change with the candidate set, so without
    // HAC-159 the target's prompts would too.
    expect(all.out.request.personaSet).not.toEqual(
      alone.out.request.personaSet,
    );
    // The site's attached Jev personas and behaviour table are the same in both runs.
    const site = (out: typeof alone.out) =>
      out.request.sites.find((s) => s.siteId === TARGET)!;
    expect(site(all.out).jevPersonaSet).toEqual(site(alone.out).jevPersonaSet);
    expect(site(all.out).behaviorTable).toEqual(site(alone.out).behaviorTable);
    expect(site(all.out).behaviorTableId).toBe(site(alone.out).behaviorTableId);
  });

  it("records the persona seed version and each site's seeding catchment in provenance", async () => {
    const alone = await assemble([TARGET]);
    const all = await assemble(ALL);
    const provenance = all.out.jevPersonaSet!;
    expect(provenance.version).toBe(JEV_PERSONA_SET_VERSION);
    expect(alone.out.jevPersonaSet?.version).toBe(JEV_PERSONA_SET_VERSION);
    expect(Object.keys(provenance.sites).sort()).toEqual([...ALL].sort());
    expect(provenance.sites[TARGET]).toEqual(
      alone.out.jevPersonaSet!.sites[TARGET],
    );
    for (const site of all.out.request.sites) {
      const own = catchmentFor(site.siteId).response.catchment.id;
      expect(provenance.sites[site.siteId]).toEqual({
        catchmentId: own,
        personaCount: site.jevPersonaSet!.personas.length,
      });
      expect(site.jevPersonaSet!.catchmentId).toBe(own);
      // Persona IDs are named by the site's own catchment, never the study area.
      for (const p of site.jevPersonaSet!.personas)
        expect(p.id.startsWith(`${own}-`)).toBe(true);
      expect(site.jevPanel?.personaCount).toBe(
        site.jevPersonaSet!.personas.length,
      );
      expect(site.behaviorTable!.personas.map((p) => p.personaId)).toEqual(
        site.jevPersonaSet!.personas.map((p) => p.id),
      );
    }
    expect(all.out.findings.some((f) => f.code === "JEV_PERSONA_SET")).toBe(
      true,
    );
  });

  it("reuses every cached answer when a candidate is removed and only asks about an added one", async () => {
    const cache = new MemoryJevCache();
    const all = await assemble(ALL, cache);
    const perSite = all.requests.length / ALL.length;
    const fewer = await assemble(ALL.slice(0, 7), cache);
    expect(fewer.requests).toHaveLength(0);
    const again = await assemble(ALL, cache);
    expect(again.requests).toHaveLength(0);
    const fresh = new MemoryJevCache();
    await assemble(ALL.slice(0, 7), fresh);
    const added = await assemble(ALL, fresh);
    expect(added.requests.length).toBe(perSite);
    expect(forSite(added.requests, ALL[7]!)).toHaveLength(perSite);
  });

  it("keeps the HAC-60 shared study area and the Huff result unchanged", async () => {
    const huff = await assembleEvaluation(
      { ...input(ALL), demandSource: "huff" },
      dependencies(ALL),
    );
    const { out: jev } = await assemble(ALL);
    const study = (out: typeof huff) =>
      out.findings.find((f) => f.code === "SHARED_STUDY_AREA");
    expect(study(jev)).toEqual(study(huff));
    expect(jev.request.personaSet).toEqual(huff.request.personaSet);
    expect(jev.request.personaSet.catchmentId).toMatch(/^study:/);
    expect(jev.assumptions).toEqual(huff.assumptions);
    expect(huff.jevPersonaSet).toBeUndefined();
    const huffOnly = evaluateSites({ ...jev.request, demandSource: "huff" });
    const strip = (sites: typeof huffOnly.result.sites) =>
      sites.map((site) =>
        Object.fromEntries(
          Object.entries(site).filter(([key]) => key !== "jevPanel"),
        ),
      );
    const baseline = evaluateSites(huff.request);
    expect(strip(huffOnly.result.sites)).toEqual(strip(baseline.result.sites));
    expect(huffOnly.result.ranking).toEqual(baseline.result.ranking);
  });

  it("Jev demand runs on each site's own personas", async () => {
    const { out } = await assemble(ALL);
    const run = evaluateSites(out.request);
    expect(run.result.demandSource).toBe("jev");
    for (const site of out.request.sites) {
      expect(demandPersonaSet(out.request, site, "jev")).toBe(
        site.jevPersonaSet,
      );
      expect(demandPersonaSet(out.request, site, "huff")).toBe(
        out.request.personaSet,
      );
      const evaluated = run.result.sites.find((s) => s.siteId === site.siteId)!;
      expect(evaluated.excludedPersonaIds).toEqual([]);
    }
    // A table answered for other personas is rejected rather than silently dropping them.
    const site = out.request.sites[0]!;
    const other = out.request.sites[1]!;
    expect(
      EvaluationSiteSchema.safeParse({
        ...site,
        jevPersonaSet: other.jevPersonaSet,
      }).success,
    ).toBe(false);
    // Requests from before HAC-159 (no per-site set) still use the shared personas.
    const legacy = { ...site, jevPersonaSet: undefined };
    expect(demandPersonaSet(out.request, legacy, "jev")).toBe(
      out.request.personaSet,
    );
  });

  it("keeps the HAC-155 deadline and resume behaviour with per-site personas", async () => {
    const ids = [ALL[0]!, TARGET];
    const deps = dependencies(ids);
    const client = fakeJevClient();
    deps.jev = { client, cache: new MemoryJevCache() };
    let clock = 0;
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
    const error = await assembleEvaluation(input(ids), deps, deadline()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PanelInProgressError);
    const progress = error as PanelInProgressError;
    const unbounded = await assemble(ids);
    const total = Object.values(unbounded.out.jevPersonaSet!.sites).reduce(
      (sum, s) => sum + s.personaCount,
      0,
    );
    expect(progress.totalPersonas).toBe(total);
    expect(progress.completedPersonas).toBeLessThan(total);
    let resumed: Awaited<ReturnType<typeof assembleEvaluation>> | undefined;
    for (let i = 0; i < 1000 && !resumed; i++)
      resumed = await assembleEvaluation(input(ids), deps, deadline()).catch(
        (e) => {
          if (e instanceof PanelInProgressError) return undefined;
          throw e;
        },
      );
    expect(resumed?.request).toEqual(unbounded.out.request);
    expect(resumed?.jevPersonaSet).toEqual(unbounded.out.jevPersonaSet);
  });
});
