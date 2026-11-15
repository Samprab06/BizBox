import { describe, expect, it } from "vitest";
import { selectedSiteFromLocation } from "./consultant-location";

describe("selectedSiteFromLocation", () => {
  it("reads the site from a site-detail path", () => {
    expect(
      selectedSiteFromLocation("/projects/houston-coffee/sites/montrose", ""),
    ).toBe("montrose");
  });

  it("reads the site from the ?site= query on other routes", () => {
    expect(
      selectedSiteFromLocation("/projects/houston-coffee/map", "?site=heights"),
    ).toBe("heights");
  });

  it("prefers the path and decodes it", () => {
    expect(
      selectedSiteFromLocation("/projects/p/sites/a%20b", "?site=other"),
    ).toBe("a b");
  });

  it("ignores missing, malformed and oversized ids", () => {
    expect(selectedSiteFromLocation("/projects/p/map", "")).toBeUndefined();
    expect(selectedSiteFromLocation("/projects/p/sites/%E0%A4%A", "")).toBeUndefined();
    expect(
      selectedSiteFromLocation("/projects/p/map", `?site=${"x".repeat(201)}`),
    ).toBeUndefined();
  });
});
