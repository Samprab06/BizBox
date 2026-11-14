import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsightsDrawer } from "./insights-drawer";

describe("city drawer provenance", () => {
  it("keeps stale and unknown-freshness qualifiers inside the modal", () => {
    const html = renderToStaticMarkup(
      h(InsightsDrawer, {
        siteId: "selected",
        outdated: true,
        profileVersionUnknown: true,
        profileVersion: 4,
      }),
    );
    const modal = html.slice(html.indexOf("<dialog"));
    expect(modal).toContain("Outdated comparison");
    expect(modal).toContain("current profile version could not be checked");
    expect(modal).toContain("Saved profile v4");
    expect(modal).toContain(
      "Representative replay data cannot supply honest seed bands",
    );
    expect(html).not.toContain("recharts-wrapper");
  });
});
