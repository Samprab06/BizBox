/**
 * Test fixtures for evaluation assembly: a synthetic Houston coffee profile and injected
 * source dependencies (three real-shaped candidate IDs, one block group, one workplace and
 * one competitor per catchment). No database or network access.
 */
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type { AssumedValue } from "@/lib/contracts";
import { buildCatchment } from "@/lib/data/catchments";
import { searchSites } from "@/lib/data/sites";
import type {
  AssembleEvaluationInput,
  AssemblyDependencies,
} from "../assemble";

export const metric = (
  value: number | null,
  origin: AssumedValue["origin"] = "founder",
): AssumedValue => ({
  value,
  origin,
  unit: "test",
  evidenceIds: ["test"],
  ...(value === null ? { unknownReason: "Unknown" } : {}),
});

/** Assembly input for three candidates, one seed, Huff demand. */
export function assemblyInput(): AssembleEvaluationInput {
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

/** Source dependencies for `raw`'s candidates; rent and size grow with list position. */
export function assemblyDependencies(
  raw: AssembleEvaluationInput = assemblyInput(),
): AssemblyDependencies {
  const ids = raw.candidateIds;
  const source = {
    origin: "costar" as const,
    dataset: "Synthetic test inventory",
    recordId: "1",
    field: "test",
  };
  return {
    searchSites: async (profile) => ({
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
    }),
    getCatchment: async (id) => ({
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
    }),
  };
}
