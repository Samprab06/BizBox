import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  liveComparisonPayload,
  liveComparisonSearch,
} from "@/tests/e2e/live-comparison-fixtures";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import { LocationResults } from "./location-results";

const render = (
  payload = liveComparisonPayload as unknown as LiveComparisonPayload,
) =>
  renderToStaticMarkup(
    createElement(LocationResults, {
      payload,
      candidates: liveComparisonSearch.candidates,
      onSelect: () => {},
      onChoose: () => {},
    }),
  );

describe("shared-axis location results", () => {
  it("shows two shared-axis charts, complete waits and all choose actions", () => {
    const html = render();
    const analytics = html.split("<details")[0];
    expect(analytics).toContain("Listing facts");
    expect(analytics).toContain("Financial performance");
    expect(analytics).toContain("Customer demand");
    expect(analytics).toContain("Operations &amp;");
    expect(analytics).toContain("Operating contribution / month");
    expect(analytics).toContain("Customers served / month");
    expect(analytics).toContain("Weekday wait");
    expect(analytics).toContain("Rent");
    expect(analytics.match(/aria-label="Create final plan for /g)).toHaveLength(
      liveComparisonPayload.result.sites.length,
    );
    expect(analytics.match(/role="img"/g)).toHaveLength(2);
    for (const site of liveComparisonPayload.result.sites)
      for (const key of [
        "monthlyContributionUsd",
        "monthlyServedCustomers",
      ] as const) {
        const metric = site[key];
        expect(analytics).toContain(
          `mean ${metric.mean}; low ${metric.low}; high ${metric.high}`,
        );
      }
  });
  it("keeps raw diagnostics out of the main view and preserves them in Technical details", () => {
    const payload = structuredClone(
      liveComparisonPayload,
    ) as unknown as LiveComparisonPayload;
    payload.assembly!.findings.push({
      code: "UNKNOWN_PARKING",
      message: "raw.internal.parking.path uses false origin default",
      siteId: payload.result.sites[0].siteId,
    });
    const html = render(payload);
    const main = html.split("<details")[0];
    expect(main).not.toContain("raw.internal.parking.path");
    expect(main).not.toContain("Parking unverified");
    expect(main).not.toContain("Not measured traffic");
    expect(main).not.toContain("Modeled ·");
    expect(html).toContain("Unverified");
    expect(html).toContain("Assumptions &amp; sources");
    expect(html).toContain("Technical details");
    for (const finding of payload.assembly!.findings)
      expect(html).toContain(finding.message);
  });
  it("keeps significant wait and capacity cautions visible", () => {
    const payload = structuredClone(
      liveComparisonPayload,
    ) as unknown as LiveComparisonPayload;
    payload.result.sites[0].weekdayMeanWaitMin = {
      ...payload.result.sites[0].weekdayMeanWaitMin,
      mean: 18,
      low: 12,
      high: 24,
    };
    const html = render(payload).split("<details")[0];
    expect(html).toContain("18.0 min");
    expect(html).toContain("Long wait · check capacity");
    expect(html).toContain("12.0 min–24.0 min");
  });
  it("shows a zero baseline only when contribution intervals contain zero", () => {
    const payload = structuredClone(
      liveComparisonPayload,
    ) as unknown as LiveComparisonPayload;
    for (const site of payload.result.sites)
      site.monthlyContributionUsd = {
        ...site.monthlyContributionUsd,
        mean: -50,
        low: -100,
        high: 100,
      };
    const html = render(payload);
    expect(html).toContain("data-zero-baseline");
    expect(html).not.toContain("NaN");
  });
});
