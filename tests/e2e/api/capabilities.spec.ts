import { z } from "zod";
import { expect, test } from "@playwright/test";
import { expectNoSecrets } from "./helpers";

/**
 * HAC-101 deployed smoke check for `GET /api/comparisons/capabilities`.
 *
 * It always checks that the body is well formed and leaks nothing, so it passes in CI and
 * locally without a Jev key. Set `E2E_EXPECT_JEV=1` to also assert `jevConfigured: true`,
 * which is how a Preview or Production deployment is checked:
 *
 *   E2E_BASE_URL=https://<preview>.vercel.app E2E_EXPECT_JEV=1 \
 *     pnpm exec playwright test api/capabilities --project=api
 *
 * The route only reports whether a key is present. It never calls Jev, so this costs nothing.
 */
const EXPECT_JEV = process.env.E2E_EXPECT_JEV === "1";

const CapabilitiesSchema = z.object({ jevConfigured: z.boolean() }).strict();

test("GET /api/comparisons/capabilities returns a well-formed body", async ({
  request,
}) => {
  const response = await request.get("/api/comparisons/capabilities");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = CapabilitiesSchema.parse(await response.json());
  expect(typeof body.jevConfigured).toBe("boolean");
  await expectNoSecrets(response);
});

test("capabilities reports Jev configured when E2E_EXPECT_JEV=1", async ({
  request,
}) => {
  test.skip(
    !EXPECT_JEV,
    "set E2E_EXPECT_JEV=1 against a deployment that has JEV_API_KEY",
  );
  const response = await request.get("/api/comparisons/capabilities");
  expect(CapabilitiesSchema.parse(await response.json())).toEqual({
    jevConfigured: true,
  });
});
