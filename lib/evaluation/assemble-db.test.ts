import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/contracts";
import { fakeJevClient } from "@/lib/panel/__fixtures__";
import { assembleEvaluation } from "./assemble";
import { createPostgresAssemblyDependencies } from "./assemble-db";
import { evaluateSites } from "./evaluate";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_ASSEMBLY_DB_TESTS === "1" &&
  !!process.env.HAC56_TEST_DATABASE_URL;

/**
 * Dedicated local PostGIS DB only, prepared with real CoStar normalized rows and
 * explicitly synthetic public catchment observations. Never uses DATABASE_URL.
 */
describe.skipIf(!enabled)(
  "assembly from local hosted-shape PostGIS [local]",
  () => {
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    let profile: BusinessProfile;
    const candidateIds = (
      process.env.HAC56_TEST_CANDIDATE_IDS ??
      "27478819:20881984,40263575:20962385,27478819:20056061"
    ).split(",");
    beforeAll(async () => {
      const url = new URL(process.env.HAC56_TEST_DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.startsWith("/hac56_test_")
      )
        throw new Error(
          "Assembly DB tests require a dedicated loopback hac56_test_ database",
        );
      client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
      db = drizzle(client);
      const [row] =
        await client`SELECT snapshot FROM profiles WHERE project_id='houston-coffee'
      AND id=${process.env.HAC56_TEST_PROFILE_ID ?? "hac56-local-coffee-v1"} LIMIT 1`;
      profile = BusinessProfileSchema.parse(row?.snapshot);
      if (!profile.synthetic)
        throw new Error(
          "Local assembly acceptance must disclose synthetic public catchment inputs",
        );
    });
    afterAll(async () => {
      if (client) await client.end({ timeout: 5 });
    });

    it("assembles and ranks three actual CoStar space IDs through the Huff pipeline", async () => {
      const assembled = await assembleEvaluation(
        {
          projectId: profile.projectId,
          profileId: profile.id,
          profileVersion: profile.version,
          profile,
          candidateIds,
          demandSource: "huff",
          seeds: 1,
        },
        createPostgresAssemblyDependencies(db, profile.projectId),
      );
      expect(assembled.request.sites.map((site) => site.siteId)).toEqual(
        candidateIds,
      );
      expect(assembled.request.synthetic).toBe(true);
      expect(assembled.request.competitors.length).toBeGreaterThan(0);
      expect(assembled.request.personaSet.personas.length).toBeGreaterThan(0);
      expect(
        assembled.assumptions[`sites.${candidateIds[0]}.monthlyBaseRentCents`]
          ?.origin,
      ).toBe("costar");
      const evaluation = evaluateSites(assembled.request);
      expect(evaluation.result.demandSource).toBe("huff");
      expect(evaluation.result.ranking).toHaveLength(3);
      expect(new Set(evaluation.result.ranking)).toEqual(new Set(candidateIds));
      expect(
        evaluation.result.sites.every((site) =>
          Number.isFinite(site.monthlyContributionUsd.mean),
        ),
      ).toBe(true);
    }, 60_000);

    it("persists alias-to-resolved mocked Jev responses and reuses them with no rerun calls", async () => {
      const fake = fakeJevClient();
      const modelVersion = `jev-latest-test-alias-${randomUUID()}`;
      const resolvedVersion = "jev-1.14.0";
      const jev = {
        modelVersion,
        ask: async (request: Parameters<typeof fake.ask>[0]) => ({
          ...(await fake.ask(request)),
          modelVersion: resolvedVersion,
        }),
      };
      const input = {
        projectId: profile.projectId,
        profileId: profile.id,
        profileVersion: profile.version,
        profile,
        candidateIds: candidateIds.slice(0, 1),
        demandSource: "jev" as const,
        seeds: 1,
      };
      const first = await assembleEvaluation(
        input,
        createPostgresAssemblyDependencies(db, profile.projectId, jev),
      );
      const calls = fake.calls;
      expect(calls).toBeGreaterThan(0);
      const [count] =
        await client`SELECT count(*)::int AS n FROM jev_cache WHERE project_id=${profile.projectId} AND model_version=${modelVersion}`;
      expect(Number(count?.n)).toBeGreaterThan(0);
      expect(first.request.sites[0]!.behaviorTable?.modelVersion).toBe(
        resolvedVersion,
      );
      const second = await assembleEvaluation(
        input,
        createPostgresAssemblyDependencies(db, profile.projectId, jev),
      );
      expect(fake.calls).toBe(calls);
      expect(second.request.sites[0]!.behaviorTable).toEqual(
        first.request.sites[0]!.behaviorTable,
      );
      expect(evaluateSites(second.request).result.demandSource).toBe("jev");
      await assembleEvaluation(
        input,
        createPostgresAssemblyDependencies(db, profile.projectId, {
          ...jev,
          modelVersion: `${modelVersion}-changed-request-model`,
        }),
      );
      expect(fake.calls).toBeGreaterThan(calls);
    }, 60_000);
  },
);
