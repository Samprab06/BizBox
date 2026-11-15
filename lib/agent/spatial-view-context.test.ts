import { expect, it } from "vitest";
import { createSpatialDraft } from "@/lib/spatial";
import {
  formatViewContext,
  resolveViewContext,
  VIEW_CONTEXT_MAX_BYTES,
} from "./view-context";
it("rejects mismatched nested spatial scope even when exterior scope is valid", async () => {
  const draft = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const input = {
    stage: "interior",
    siteId: "s",
    comparisonId: "c",
    spatial: {
      comparisonId: "foreign",
      baseline: draft,
      draft,
      reviewed: false,
    },
  };
  await expect(
    resolveViewContext("p", input, {
      comparison: async () => ({ id: "c", projectId: "p", siteIds: ["s"] }),
      scenario: async () => null,
      investigation: async () => null,
      candidates: async () => ["s"],
    }),
  ).rejects.toThrow();
});
it("keeps spatial context model text bounded without dropping tool-side snapshots", () => {
  const draft = createSpatialDraft({
    projectId: "p",
    siteId: "s",
    city: "houston",
  });
  const line = formatViewContext({
    stage: "interior",
    siteId: "s",
    comparisonId: "c",
    spatial: { comparisonId: "c", baseline: draft, draft, reviewed: false },
  });
  expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(
    VIEW_CONTEXT_MAX_BYTES,
  );
  expect(line).toContain("interior");
});
