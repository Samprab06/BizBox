import { z } from "zod";
import { expect, test } from "@playwright/test";
import { WITH_DB, expectNoSecrets } from "./helpers";

const HealthSchema = z.object({
  status: z.enum(["ok", "error"]),
  database: z.object({ status: z.string(), postgis: z.boolean().optional() }),
  code: z.string().optional(),
  message: z.string().optional(),
});

test("GET /api/health reports database status in its contract shape", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  expect([200, 503]).toContain(response.status());
  const body = HealthSchema.parse(await response.json());
  if (WITH_DB) {
    expect(response.status()).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      database: { status: "connected", postgis: true },
    });
  }
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expectNoSecrets(response);
});

test("GET /api/comparisons/capabilities reports only key presence", async ({
  request,
}) => {
  const response = await request.get("/api/comparisons/capabilities");
  expect(response.status()).toBe(200);
  const body = z
    .object({ jevConfigured: z.boolean() })
    .strict()
    .parse(await response.json());
  expect(typeof body.jevConfigured).toBe("boolean");
  await expectNoSecrets(response);
});
