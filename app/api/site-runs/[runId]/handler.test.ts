import { describe, expect, it, vi } from "vitest";
import { createSiteRunReadHandler } from "./handler";

const run = {
  id: "cmp1:101:1:weekday:1",
  projectId: "houston-coffee",
  synthetic: false,
  siteId: "101:1",
  profileId: "profile1",
  arrivalScheduleId: "arrivals1",
  modelVersion: "model1",
  seed: 1,
  dayType: "weekday",
  outputKind: "simulated",
  metrics: {
    completedCustomers: 1,
    unservedCustomers: 0,
    revenueCents: 700,
    includedCostCents: 200,
    operatingContributionCents: 500,
    averageWaitMinutes: 0,
  },
  events: [
    { customerId: "customer1", minute: 420, type: "arrived" },
    { customerId: "customer1", minute: 420, type: "joined" },
    { customerId: "customer1", minute: 424, type: "served" },
    { customerId: "customer1", minute: 424, type: "departed" },
  ],
};
const request = (query = "projectId=houston-coffee") =>
  new Request(`http://local.test/api/site-runs/run?${query}`);
describe("GET project-scoped site run", () => {
  it("returns canonical stored events and metrics, decoding the encoded identifier once", async () => {
    const load = vi.fn().mockResolvedValue(run);
    const response = await createSiteRunReadHandler(load)(
      request(),
      encodeURIComponent(run.id),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ run });
    expect(load).toHaveBeenCalledWith(run.projectId, run.id);
  });
  it.each([
    "",
    "projectId=",
    "projectId=%20",
    "projectId=a&projectId=b",
    `projectId=${"x".repeat(201)}`,
  ])("rejects invalid project queries before loading", async (query) => {
    const load = vi.fn();
    const response = await createSiteRunReadHandler(load)(
      request(query),
      run.id,
    );
    expect(response.status).toBe(422);
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["%bad", "%253A", "run%2Fother", "../run", "", "x".repeat(513)])(
    "rejects malformed, double encoded and slash identifiers before loading",
    async (id) => {
      const load = vi.fn();
      const response = await createSiteRunReadHandler(load)(request(), id);
      expect(response.status).toBe(422);
      expect(load).not.toHaveBeenCalled();
    },
  );
  it("returns 404 for a missing scoped record", async () => {
    const response = await createSiteRunReadHandler(async () => null)(
      request(),
      run.id,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "SITE_RUN_NOT_FOUND" });
  });
  it("does not expose another project or an unexpected stored ID", async () => {
    for (const stored of [
      { ...run, projectId: "another-project" },
      { ...run, id: "another-run" },
    ]) {
      const response = await createSiteRunReadHandler(async () => stored)(
        request(),
        run.id,
      );
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain("another-");
    }
  });
  it("returns a safe unavailable response for malformed stored data or database failures", async () => {
    for (const load of [
      async () => ({ ...run, events: [{ type: "invalid" }] }),
      async () => {
        throw new Error("private database detail");
      },
    ]) {
      const response = await createSiteRunReadHandler(load)(request(), run.id);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        code: "SITE_RUN_UNAVAILABLE",
        message: "The stored site run could not be loaded. Please try again.",
        field_errors: {},
      });
    }
  });
});
