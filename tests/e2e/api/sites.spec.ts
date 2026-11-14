import { expect, test } from "@playwright/test";
import { SiteSearchResultSchema } from "../../../lib/contracts/sites";
import { CatchmentResponseSchema } from "../../../lib/contracts/catchment";
import {
  PROJECT_ID,
  WITH_DB,
  expectClientError,
  expectKnownOrigins,
  expectNoSecrets,
  testProfile,
} from "./helpers";

test.describe("POST /api/sites", () => {
  test("rejects missing, mistyped and out-of-range fields without a 500", async ({
    request,
  }) => {
    for (const data of [
      {},
      { profile: "not a profile" },
      { profile: testProfile(), limit: 99 },
    ]) {
      await expectClientError(await request.post("/api/sites", { data }));
    }
    await expectClientError(
      await request.post("/api/sites", {
        data: "{not json",
        headers: { "content-type": "application/json" },
      }),
    );
  });

  test("returns a ranked, sourced shortlist for the Houston coffee profile", async ({
    request,
  }) => {
    test.skip(!WITH_DB, "needs a loaded database (E2E_DB=1)");
    const response = await request.post("/api/sites", {
      data: { profile: testProfile(), limit: 5 },
    });
    expect(response.status()).toBe(200);
    const body = SiteSearchResultSchema.parse(await response.json());
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates.length).toBeLessThanOrEqual(5);
    expectKnownOrigins(body);
    await expectNoSecrets(response);
  });
});

test.describe("GET /api/sites/[siteId]/catchment", () => {
  test("rejects malformed site IDs and queries", async ({ request }) => {
    await expectClientError(
      await request.get(
        `/api/sites/not-a-site/catchment?projectId=${PROJECT_ID}&category=coffee`,
      ),
      [400, 404, 422],
    );
    await expectClientError(
      await request.get(
        `/api/sites/123/catchment?projectId=${PROJECT_ID}&category=nightclub`,
      ),
      [400, 404, 422],
    );
    await expectClientError(
      await request.get(
        `/api/sites/123/catchment?projectId=${PROJECT_ID}&category=coffee&radiusMeters=5`,
      ),
      [400, 404, 422],
    );
  });

  test("returns a sourced catchment for a real candidate, and 404 for unknown ones", async ({
    request,
  }) => {
    test.skip(!WITH_DB, "needs a loaded database (E2E_DB=1)");
    const search = SiteSearchResultSchema.parse(
      await (
        await request.post("/api/sites", {
          data: { profile: testProfile(), limit: 1 },
        })
      ).json(),
    );
    const id = encodeURIComponent(search.candidates[0]!.candidate.id);
    const response = await request.get(
      `/api/sites/${id}/catchment?projectId=${PROJECT_ID}&category=coffee&radiusMeters=1000`,
    );
    expect(response.status()).toBe(200);
    const body = CatchmentResponseSchema.parse(await response.json());
    expectKnownOrigins(body);
    await expectNoSecrets(response);
    expect(
      (
        await request.get(
          `/api/sites/999999999/catchment?projectId=${PROJECT_ID}&category=coffee`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(
          `/api/sites/${id}/catchment?projectId=no-such-project&category=coffee`,
        )
      ).status(),
    ).toBe(404);
  });
});
