import { z } from "zod";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  BusinessProfileSchema,
  SiteComparisonSchema,
  SiteRunSchema,
} from "../../../lib/contracts";
import {
  EvaluationResultSchema,
  SensitivityResultSchema,
} from "../../../lib/contracts/evaluation";
import { SiteSearchResultSchema } from "../../../lib/contracts/sites";
import {
  PROJECT_ID,
  WITH_DB,
  expectClientError,
  expectKnownOrigins,
  expectNoSecrets,
  testProfile,
} from "./helpers";

const ProfileResponse = z.object({
  profile: BusinessProfileSchema,
  persisted: z.literal(true),
});
const ComparisonResponse = z.object({
  comparisonId: z.string().min(1),
  outdated: z.boolean(),
  result: EvaluationResultSchema,
  comparison: SiteComparisonSchema,
});

test.describe("validation (no database needed)", () => {
  test("profiles, comparisons and sensitivity reject bad input without a 500", async ({
    request,
  }) => {
    await expectClientError(await request.post("/api/profiles", { data: {} }));
    await expectClientError(
      await request.post("/api/profiles", {
        data: { projectId: PROJECT_ID, profile: { city: 3 } },
      }),
    );
    await expectClientError(
      await request.post("/api/comparisons", { data: {} }),
    );
    await expectClientError(
      await request.post("/api/comparisons", {
        data: {
          projectId: PROJECT_ID,
          profileId: "p",
          candidateIds: Array.from({ length: 9 }, (_, i) => `${i}:1`),
        },
      }),
    );
    await expectClientError(
      await request.post("/api/comparisons/x/sensitivity", {
        data: { assumption: "weather" },
      }),
    );
    await expectClientError(await request.get("/api/comparisons/x"));
    await expectClientError(await request.get("/api/site-runs/x"));
    await expectClientError(
      await request.get(
        `/api/site-runs/${encodeURIComponent("a/b")}?projectId=${PROJECT_ID}`,
      ),
    );
  });
});

async function comparisonFor(request: APIRequestContext) {
  const saved = ProfileResponse.parse(
    await (
      await request.post("/api/profiles", {
        data: { projectId: PROJECT_ID, profile: testProfile() },
      })
    ).json(),
  );
  const search = SiteSearchResultSchema.parse(
    await (
      await request.post("/api/sites", {
        data: { profile: testProfile(), limit: 3 },
      })
    ).json(),
  );
  const candidateIds = search.candidates.slice(0, 3).map((c) => c.candidate.id);
  const response = await request.post("/api/comparisons", {
    data: {
      projectId: PROJECT_ID,
      profileId: saved.profile.id,
      candidateIds,
      demandSource: "huff",
      seeds: 4,
    },
    timeout: 90_000,
  });
  return { response, saved, candidateIds };
}

test.describe("happy paths (E2E_DB=1)", () => {
  test.skip(!WITH_DB, "needs a loaded database (E2E_DB=1)");
  test.describe.configure({ mode: "serial" });

  test("profile snapshot → comparison → identical rerun → sensitivity → stored site run", async ({
    request,
  }) => {
    const { response, saved, candidateIds } = await comparisonFor(request);
    expect(response.status()).toBe(201);
    const created = ComparisonResponse.parse(await response.json());
    expect(created.result.demandSource).toBe("huff");
    expect(
      created.result.ranking.every((id) => candidateIds.includes(id)),
    ).toBe(true);
    expectKnownOrigins(created);
    await expectNoSecrets(response);

    // Determinism: the same stored request reruns to identical numbers.
    const rerun = await request.post("/api/comparisons", {
      data: { projectId: PROJECT_ID, rerunComparisonId: created.comparisonId },
      timeout: 90_000,
    });
    expect(rerun.status()).toBe(201);
    const again = ComparisonResponse.extend({ reproduces: z.boolean() }).parse(
      await rerun.json(),
    );
    expect(again.reproduces).toBe(true);
    expect(again.result.sites.map((s) => s.monthlyContributionUsd)).toEqual(
      created.result.sites.map((s) => s.monthlyContributionUsd),
    );

    const read = await request.get(
      `/api/comparisons/${created.comparisonId}?projectId=${PROJECT_ID}`,
    );
    expect(read.status()).toBe(200);
    expect(ComparisonResponse.parse(await read.json()).comparisonId).toBe(
      created.comparisonId,
    );

    const sensitivity = await request.post(
      `/api/comparisons/${created.comparisonId}/sensitivity`,
      {
        data: {
          projectId: PROJECT_ID,
          assumption: "rent",
          values: [0.9, 1, 1.1],
          seeds: 2,
        },
        timeout: 90_000,
      },
    );
    expect(sensitivity.status()).toBe(200);
    const s = z
      .object({ sensitivity: SensitivityResultSchema })
      .parse(await sensitivity.json()).sensitivity;
    expect(s.points.map((p) => p.value)).toEqual([0.9, 1, 1.1]);

    const runId = created.result.sites[0]!.representative.weekday.runId;
    const run = await request.get(
      `/api/site-runs/${encodeURIComponent(runId)}?projectId=${PROJECT_ID}`,
    );
    expect(run.status()).toBe(200);
    expect(SiteRunSchema.parse((await run.json()).run).id).toBe(runId);
    expect(
      (
        await request.get(
          `/api/site-runs/${encodeURIComponent(runId)}?projectId=no-such-project`,
        )
      ).status(),
    ).toBe(404);
    expect(saved.profile.projectId).toBe(PROJECT_ID);
  });

  test("unknown comparison IDs are 404", async ({ request }) => {
    expect(
      (
        await request.get(
          `/api/comparisons/cmp_missing?projectId=${PROJECT_ID}`,
        )
      ).status(),
    ).toBe(404);
    const sensitivity = await request.post(
      "/api/comparisons/cmp_missing/sensitivity",
      {
        data: { projectId: PROJECT_ID, assumption: "rent" },
      },
    );
    expect(sensitivity.status()).toBe(404);
  });
});
