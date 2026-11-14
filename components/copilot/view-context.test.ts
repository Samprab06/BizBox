import { describe, expect, it } from "vitest";
import { viewContextFor } from "./view-context";

describe("viewContextFor", () => {
  it("reads the stage, site, comparison and active scenario", () => {
    expect(
      viewContextFor(
        "/projects/houston-coffee/simulator",
        "comparison=c1&site=montrose",
        "s2",
      ),
    ).toEqual({
      stage: "simulator",
      siteId: "montrose",
      comparisonId: "c1",
      scenarioId: "s2",
    });
  });

  it("maps site detail URLs and ignores the unselected placeholder", () => {
    expect(viewContextFor("/projects/p/sites/heights", "", null)).toEqual({
      stage: "site",
      siteId: "heights",
    });
    expect(viewContextFor("/projects/p/sites/unselected", "", null)).toEqual({
      stage: "site",
    });
  });

  it("falls back to the workspace stage and drops oversized values", () => {
    expect(
      viewContextFor("/projects/p/unknown", `site=${"x".repeat(300)}`, null),
    ).toEqual({ stage: "workspace" });
  });
});
