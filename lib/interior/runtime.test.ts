import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../db/client", () => ({
  getDb() {
    throw new Error("Provider unavailable: private connection details");
  },
}));
import { getInterior } from "./runtime";
import { createInteriorHandler } from "../../app/api/sites/[siteId]/interior/handler";
import { GET as floorplan } from "../../app/api/sites/[siteId]/interior/floorplan/route";

describe("offline interior runtime", () => {
  it("serves fixture content with the database provider unavailable", async () => {
    const response = await createInteriorHandler(getInterior)(
      new Request("http://localhost/interior"),
      { params: Promise.resolve({ siteId: "interior-fixture-scan" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "scan",
      provenance: { mode: "synthetic" },
    });
  });
  it("returns a sanitized 503 for ordinary sites when the provider is unavailable", async () => {
    const response = await createInteriorHandler(getInterior)(
      new Request("http://localhost/interior"),
      { params: Promise.resolve({ siteId: "12:34" }) },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private|connection|Provider/);
  });
  it("provides its authored floorplan locally and does not proxy arbitrary sites", async () => {
    const request = new Request("http://localhost/interior/floorplan");
    const response = await floorplan(request, {
      params: Promise.resolve({ siteId: "interior-fixture-floorplan" }),
    });
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("Synthetic example");
    expect(
      (
        await floorplan(request, {
          params: Promise.resolve({ siteId: "12:34" }),
        })
      ).status,
    ).toBe(404);
  });
});
