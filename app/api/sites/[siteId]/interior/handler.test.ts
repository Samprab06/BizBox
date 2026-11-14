import { describe, expect, it } from "vitest";
import { createInteriorHandler } from "./handler";
import { resolveInterior } from "@/lib/interior/service";

const context = (siteId: string) => ({ params: Promise.resolve({ siteId }) });
const request = (query = "") =>
  new Request(`http://localhost/api/sites/x/interior${query}`);
const offline = (id: string) => resolveInterior(id, async () => null);

describe("interior route", () => {
  it.each(["scan", "floorplan", "modeled"])(
    "returns a %s fixture without provider configuration",
    async (kind) => {
      const response = await createInteriorHandler(offline)(
        request(),
        context(`interior-fixture-${kind}`),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        kind,
        provenance: { mode: "synthetic" },
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it.each([
    "12",
    "%ZZ",
    "12%3A34",
    "12%253A34",
    "12%2F34",
    "12;DROP",
    "interior-fixture-unknown",
  ])("rejects invalid identifiers: %s", async (id) => {
    expect(
      (await createInteriorHandler(offline)(request(), context(id))).status,
    ).toBe(400);
  });
  it("accepts the canonical site ID already decoded by Next and returns 404 when missing", async () => {
    expect(
      (await createInteriorHandler(offline)(request(), context("12:34")))
        .status,
    ).toBe(404);
  });
  it("rejects query options that could enable private sources", async () => {
    expect(
      (
        await createInteriorHandler(offline)(
          request("?live=1"),
          context("12:34"),
        )
      ).status,
    ).toBe(400);
  });
  it("sanitizes database/provider failures", async () => {
    const response = await createInteriorHandler(async () => {
      throw new Error("postgres://user:private@host/db token-private");
    })(request(), context("12:34"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private|postgres|token/);
  });
});
