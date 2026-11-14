import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFixtureInsights } from "@/lib/insights/model";
import { InsightsPanel } from "./insights-panel";

describe("Insights presentation", () => {
  it("keeps seed uncertainty, tail waits and modeled provenance explicit alongside readable tables", () => {
    const data = buildFixtureInsights({ siteId: "site", seeds: 3 });
    const html = renderToStaticMarkup(h(InsightsPanel, { data }));
    expect(html).toContain("Weekday");
    expect(html).toContain("Weekend");
    expect(html).toContain("p5–p95");
    expect(html).toContain("within-seed p90");
    expect(html).toContain("not a confidence interval");
    expect(html).toContain("Modeled, not a forecast");
    expect(html).toContain("Authored synthetic origins");
    expect(html).toContain("<table");
    expect(html).toContain("Open minutes");
  });

  it("shows the real missing-map reason and never substitutes persona locations", () => {
    const data = buildFixtureInsights({ siteId: "site", seeds: 2 });
    data.days.weekday.servedOriginMap = {
      status: "unavailable",
      reason: "Sampled trip origins were not retained.",
    };
    const html = renderToStaticMarkup(h(InsightsPanel, { data }));
    expect(html).toContain("Sampled trip origins were not retained.");
    expect(html).not.toContain("Authored synthetic origins");
  });

  it("preserves unknown wait observations and unknown capacity provenance", () => {
    const data = buildFixtureInsights({ siteId: "site", seeds: 2 });
    const row = data.days.weekday.hours.find((item) => !item.closed)!;
    row.meanWaitMin = { mean: null, p5: null, p95: null };
    row.p90WaitMin = { mean: null, p5: null, p95: null };
    row.waitObservedSeeds = 0;
    data.days.weekday.capacityInputs.serviceMeanOrigin = null;
    const html = renderToStaticMarkup(
      h(InsightsPanel, { data, surface: "viewport" }),
    );
    expect(html).toContain("Unknown");
    expect(html).toContain("service-time origin unknown");
    expect(html).toContain('data-surface="viewport"');
  });
});
