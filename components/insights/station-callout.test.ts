import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { STATION_EXPERIMENT_FIXTURES } from "@/lib/insights/station-experiment-fixture";
import { StationCallout } from "./station-callout";
describe("station recommendation presentation", () => {
  it("retains exact helper values, negative contribution and full-day assumptions", () => {
    const value = STATION_EXPERIMENT_FIXTURES.montrose.weekday!;
    const html = renderToStaticMarkup(
      h(StationCallout, { value, sourceLabel: "Authored synthetic example" }),
    );
    expect(html).toContain(`value="${value.monthlyRevenueChangeUsd.mean}"`);
    expect(html).toContain(
      `value="${value.monthlyContributionChangeUsd.mean}"`,
    );
    expect(html).toContain("Contribution decreases");
    expect(html).toContain("p5–p95");
    expect(html).toContain("not a confidence interval");
    expect(html).toContain("Whole operating days");
    expect(html).toContain("Staff-hours");
    expect(html).toContain("capacity proxy");
    expect(html).toContain("Simulation");
    expect(html).toContain("Recorded input origins");
    expect(html).toContain("Modeled, not a forecast");
    expect(html).not.toContain("recovers");
  });
});
