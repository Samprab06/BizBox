import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createSpatialDraft } from "@/lib/spatial";
import { SpatialReport } from "./spatial-report";
describe("combined report interior evidence", () => {
  it("includes separately labeled modeled interior metrics for both cities and all existing categories", () => {
    for (const city of ["houston", "los_angeles"] as const)
      for (const category of [
        "coffee",
        "quick_food",
        "salon_barber",
        "fitness",
      ] as const) {
        const draft = createSpatialDraft({
          projectId: "p",
          siteId: "s",
          city,
          category,
        });
        const html = renderToStaticMarkup(
          createElement(SpatialReport, {
            interior: {
              comparisonId: "c",
              siteId: "s",
              baseline: draft,
              draft,
              ranRevision: 0,
              reviewedRevision: 0,
            },
          }),
        );
        expect(html).toContain("Interior experiment");
        expect(html).toContain("assumed customer behavior");
        expect(html).toContain("do not replace exterior monthly estimates");
      }
  });
  it("refuses stale reviewed evidence rather than rendering old metrics", () => {
    const draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    });
    const html = renderToStaticMarkup(
      createElement(SpatialReport, {
        interior: {
          comparisonId: "c",
          siteId: "s",
          baseline: draft,
          draft: { ...draft, revision: 1 },
          ranRevision: 0,
          reviewedRevision: 0,
        },
      }),
    );
    expect(html).toContain("Run and review");
    expect(html).not.toContain("Customers served");
  });
});
