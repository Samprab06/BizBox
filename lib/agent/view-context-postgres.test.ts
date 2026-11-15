import { beforeEach, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  inventory: vi.fn(),
  search: vi.fn(),
  db: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/evaluation/store-postgres", () => ({
  createPostgresComparisonStore: () => ({ load: mocks.load }),
}));
vi.mock("@/app/api/sites/inventory", () => ({
  loadSiteInventory: mocks.inventory,
}));
vi.mock("@/lib/data/sites", () => ({ searchSites: mocks.search }));
vi.mock("@/lib/db/client", () => ({ getDb: mocks.db }));
import { createPostgresViewContextLookups } from "./view-context-postgres";

beforeEach(() => {
  vi.resetAllMocks();
});
it("recomputes project shortlist from canonical current draft without requiring a saved profile", async () => {
  const profile = { ...syntheticHoustonFixture.profile, projectId: "project" };
  mocks.inventory.mockResolvedValue({ source: "server inventory" });
  mocks.search.mockReturnValue({
    candidates: [{ candidate: { id: "screen" } }],
  });
  expect(
    await createPostgresViewContextLookups().candidates("project", profile),
  ).toEqual(["screen"]);
  expect(mocks.search).toHaveBeenCalledWith(
    { profile, limit: 8 },
    { source: "server inventory" },
  );
  expect(mocks.db).not.toHaveBeenCalled();
});
it("rejects a profile for another project before inventory work", async () => {
  await expect(
    createPostgresViewContextLookups().candidates("project", {
      ...syntheticHoustonFixture.profile,
      projectId: "other",
    }),
  ).rejects.toThrow("Profile scope mismatch");
  expect(mocks.inventory).not.toHaveBeenCalled();
});
it("rechecks persisted comparison project identities even after a scoped store lookup", async () => {
  mocks.load.mockResolvedValue({
    id: "comparison",
    comparison: { projectId: "other" },
    evaluation: {
      request: { projectId: "project" },
      result: { projectId: "project" },
    },
  });
  expect(
    await createPostgresViewContextLookups().comparison(
      "project",
      "comparison",
    ),
  ).toBeNull();
  expect(mocks.load).toHaveBeenCalledWith("project", "comparison");
});
it("no longer resolves scenario IDs, so a scenarioId fails closed", async () => {
  expect(
    await createPostgresViewContextLookups().scenario("project", "scenario"),
  ).toBeNull();
  expect(mocks.db).not.toHaveBeenCalled();
});
