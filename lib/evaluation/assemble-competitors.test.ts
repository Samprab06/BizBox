/**
 * HAC-156: each site's Jev competitor set comes from that site's own catchment, so the Jev
 * requests for a site (and their cache keys) do not change when other candidates are added or
 * removed. The union study area (HAC-60) still drives the population and Huff. Fake Jev only.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { searchSites } from "@/lib/data/sites";
import { buildCatchment } from "@/lib/data/catchments";
import { MemoryJevCache } from "@/lib/panel/cache";
import { catchment, fakeJevClient, makeSites } from "@/lib/panel/__fixtures__";
import type { JevAskRequest } from "@/lib/panel/jev-client";
import { runPanelForSites } from "@/lib/panel/panel";
import { buildPersonas } from "@/lib/panel/personas";
import type { CandidateSite } from "@/lib/panel/contracts";
import { evaluateSites } from "./evaluate";
import {
  assembleEvaluation,
  JEV_COMPETITOR_SET_VERSION,
  JEV_MAX_COMPETITORS,
  siteJevCompetitors,
  type AssembleEvaluationInput,
  type AssemblyCatchment,
  type AssemblyDependencies,
} from "./assemble";

const optionId = (id: string) =>
  `s_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
const ALL = Array.from({ length: 8 }, (_, i) => `${101 + i}:${i + 1}`);
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
  };
}

/** Each site's catchment holds one venue of its own plus `shared`, and a shared population. */
function catchmentFor(id: string, venues = 1): AssemblyCatchment {
  const index = ALL.indexOf(id);
  const own = Array.from({ length: venues }, (_, v) => ({
    id: `venue-${index}-${v}`,
    name: `Coffee ${index}-${v}`,
    category: "coffee" as const,
    latitude: 29.76 + index * 0.001 + v * 0.0001,
    longitude: -95.371,
    origin: "public" as const,
    source: {},
  }));
  const shared = {
    id: "shared",
    name: "Shared coffee",
    category: "coffee" as const,
    latitude: 29.765,
    longitude: -95.37,
    origin: "public" as const,
    source: {},
  };
  return {
    response: buildCatchment({
      site: {
        id,
        propertyId: String(index + 1),
        projectId: "test-project",
        city: "Houston",
        latitude: 29.76 + index * 0.001,
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
      venues: [...own, shared],
      coTenants: [],
    }),
    locations: {
      blockGroups: { bg: { lat: 29.76, lng: -95.37 } },
      workers: { job: { lat: 29.76, lng: -95.37 } },
      competitors: Object.fromEntries(
        [...own, shared].map((v) => [
          `public:${v.id}`,
          { lat: v.latitude, lng: v.longitude, origin: "public" as const },
        ]),
      ),
    },
  };
}

function dependencies(ids: string[], venues = 1): AssemblyDependencies {
  return {
    searchSites: vi.fn(async (profile) => ({
      result: searchSites(
        { profile, limit: 8 },
        {
          properties: ids.map((id) => ({
            id: String(ALL.indexOf(id) + 1),
            city: "Houston",
            latitude: 29.76 + ALL.indexOf(id) * 0.001,
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
    getCatchment: vi.fn(async (id) => catchmentFor(id, venues)),
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

const forSite = (requests: JevAskRequest[], siteOptionId: string) =>
  requests
    .filter((r) => siteOptionId in r.state.options)
    .map((r) => JSON.stringify(r))
    .sort();

describe("per-site Jev competitor sets (HAC-156)", () => {
  it("a site gets byte-identical Jev requests alone or with 7 other candidates", async () => {
    // Same persona set in both runs, so only the competitor rule can change the prompts.
    const personaSet = buildPersonas(catchment, { count: 30 });
    const ids = ALL;
    const sites: CandidateSite[] = makeSites(8).map((s, i) => ({
      ...s,
      id: optionId(ids[i]!),
    }));
    const competitorsBySite = new Map(
      ids.map((id, i) => [
        sites[i]!.id,
        siteJevCompetitors(catchmentFor(id), {
          businessType: "coffee",
          priceUsd: 6,
        }).competitors.map((c) => c.competitor),
      ]),
    );
    const run = async (subset: CandidateSite[], union: boolean) => {
      const { client, requests } = recordingJev();
      const unionCompetitors = subset.flatMap((s) =>
        competitorsBySite.get(s.id)!,
      );
      await runPanelForSites({
        personaSet,
        sites: subset,
        competitors: union
          ? unionCompetitors.filter(
              (c, i) => unionCompetitors.findIndex((d) => d.id === c.id) === i,
            )
          : [],
        ...(union
          ? {}
          : {
              competitorsForSite: (site: CandidateSite) =>
                competitorsBySite.get(site.id)!,
            }),
        need: { businessType: "coffee", priceUsd: 6, serviceMinPerCustomer: 2 },
        client,
        cache: new MemoryJevCache(),
        seed: 3,
      });
      return requests;
    };
    const target = sites[2]!;
    const alone = forSite(await run([target], false), target.id);
    const withOthers = forSite(await run(sites, false), target.id);
    expect(alone.length).toBe(30 * 4);
    expect(withOthers).toEqual(alone);
    // Control: the old union competitor list changes the same site's prompts.
    const unionAlone = forSite(await run([target], true), target.id);
    expect(forSite(await run(sites, true), target.id)).not.toEqual(unionAlone);
  });

  it("assembly records each site's competitor set and its version, independent of the other candidates", async () => {
    const target = ALL[2]!;
    const assemble = async (ids: string[]) => {
      const raw = { ...input(ids), demandSource: "jev" as const };
      const { client, requests } = recordingJev();
      const deps = dependencies(ids);
      deps.jev = { client, cache: new MemoryJevCache() };
      return { out: await assembleEvaluation(raw, deps), requests };
    };
    const alone = await assemble([target]);
    const all = await assemble(ALL);
    expect(alone.out.jevCompetitorSet?.version).toBe(
      JEV_COMPETITOR_SET_VERSION,
    );
    expect(all.out.jevCompetitorSet?.version).toBe(JEV_COMPETITOR_SET_VERSION);
    expect(all.out.jevCompetitorSet?.sites[target]).toEqual(
      alone.out.jevCompetitorSet?.sites[target],
    );
    expect(
      alone.out.jevCompetitorSet?.sites[target]?.competitorIds,
    ).toHaveLength(2);
    expect(Object.keys(all.out.jevCompetitorSet!.sites).sort()).toEqual(
      [...ALL].sort(),
    );
    // The site's Jev options are its own catchment's venues, never other sites'.
    const optionKeys = (requests: JevAskRequest[]) =>
      new Set(
        requests
          .filter((r) => optionId(target) in r.state.options)
          .flatMap((r) => Object.keys(r.state.options)),
      );
    const expected = new Set([
      optionId(target),
      ...alone.out.jevCompetitorSet!.sites[target]!.competitorIds.map(optionId),
    ]);
    expect(optionKeys(alone.requests)).toEqual(expected);
    expect(optionKeys(all.requests)).toEqual(expected);
    expect(all.out.findings.some((f) => f.code === "JEV_COMPETITOR_SET")).toBe(
      true,
    );
    for (const site of all.out.request.sites)
      expect(site.behaviorTable).toBeDefined();
  });

  it("keeps the HAC-60 shared study area and the Huff result unchanged", async () => {
    const huffDeps = dependencies(ALL);
    const huff = await assembleEvaluation(input(ALL), huffDeps);
    const jevDeps = dependencies(ALL);
    jevDeps.jev = { client: fakeJevClient(), cache: new MemoryJevCache() };
    const jev = await assembleEvaluation(
      { ...input(ALL), demandSource: "jev" },
      jevDeps,
    );
    const study = (out: typeof huff) =>
      out.findings.find((f) => f.code === "SHARED_STUDY_AREA");
    expect(study(huff)).toBeDefined();
    expect(study(jev)).toEqual(study(huff));
    // Huff still sees the union of all catchments' competitors.
    expect(jev.request.competitors).toEqual(huff.request.competitors);
    expect(huff.request.competitors.length).toBe(ALL.length + 1);
    expect(jev.request.personaSet).toEqual(huff.request.personaSet);
    expect(huff.jevCompetitorSet).toBeUndefined();
    // The Huff-only check of the Jev request matches the Huff request's result.
    const huffOnly = evaluateSites({ ...jev.request, demandSource: "huff" });
    // Jev panel coverage is the only per-site addition in the Jev request.
    const withoutPanel = (sites: typeof huffOnly.result.sites) =>
      sites.map((site) =>
        Object.fromEntries(
          Object.entries(site).filter(([key]) => key !== "jevPanel"),
        ),
      );
    expect(withoutPanel(huffOnly.result.sites)).toEqual(
      withoutPanel(evaluateSites(huff.request).result.sites),
    );
    expect(huffOnly.result.ranking).toEqual(
      evaluateSites(huff.request).result.ranking,
    );
  });

  it("sorts by stable venue ID and caps, reporting the cap", async () => {
    const id = ALL[0]!;
    const bundle = catchmentFor(id, JEV_MAX_COMPETITORS + 5);
    const reversed: AssemblyCatchment = {
      ...bundle,
      response: {
        ...bundle.response,
        competitors: [...bundle.response.competitors].reverse(),
      },
    };
    const a = siteJevCompetitors(bundle, {
      businessType: "coffee",
      priceUsd: 6,
    });
    const b = siteJevCompetitors(reversed, {
      businessType: "coffee",
      priceUsd: 6,
    });
    expect(a.eligibleCount).toBe(JEV_MAX_COMPETITORS + 6);
    expect(a.competitors).toHaveLength(JEV_MAX_COMPETITORS);
    expect(b).toEqual(a);
    const sorted = a.competitors.map((c) => c.sourceId);
    expect(sorted).toEqual([...sorted].sort());

    const deps = dependencies([id], JEV_MAX_COMPETITORS + 5);
    deps.jev = { client: fakeJevClient(), cache: new MemoryJevCache() };
    const out = await assembleEvaluation(
      { ...input([id]), demandSource: "jev" },
      deps,
    );
    expect(out.jevCompetitorSet?.sites[id]).toEqual({
      competitorIds: sorted,
      capped: true,
    });
    expect(
      out.findings.some(
        (f) => f.code === "JEV_COMPETITORS_CAPPED" && f.siteId === id,
      ),
    ).toBe(true);
  });
});
