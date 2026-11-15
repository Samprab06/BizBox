import { describe, expect, it } from "vitest";
import {
  buildSiteLabels,
  humanizeText,
  metricLabel,
  replaceSiteIds,
  sourceLabels,
  statusSentence,
  stripCitations,
} from "./plan-copy";

const labels = { "40263575:20962385": "12 Main St" };

describe("plan copy", () => {
  it("replaces known and leftover site ids", () => {
    expect(replaceSiteIds("40263575:20962385: Compare", labels)).toBe(
      "12 Main St: Compare",
    );
    expect(replaceSiteIds("vs 27478819:20881984", labels)).toBe(
      "vs another compared site",
    );
    expect(replaceSiteIds("open 9:30", labels)).toBe("open 9:30");
  });

  it("strips citation tags", () => {
    expect(
      stripCitations("Go. [comparison:cmp_1] Then [run:r1][evidence:e]"),
    ).toBe("Go. Then");
  });

  it("labels metrics from paths", () => {
    expect(metricLabel("sites.40263575:20962385.monthlyContributionUsd")).toBe(
      "Monthly operating contribution",
    );
    expect(metricLabel("monthlyContributionAfterBuildoutUsd")).toBe(
      "Monthly contribution after buildout",
    );
    expect(metricLabel("sites.a.monthlyServedCustomers")).toBe(
      "Customers per month",
    );
    expect(metricLabel("weekdayMeanWaitMin")).toBe("Weekday wait");
    expect(metricLabel("rent")).toBe("Monthly rent");
    expect(metricLabel("sites.a.someNewThingUsd")).toBe("Some New Thing");
  });

  it("labels and de-duplicates sources", () => {
    expect(
      sourceLabels(["default", "founder", "default", "public", "costar"]),
    ).toEqual(["Your answers", "Listing data", "Public data", "Assumption"]);
  });

  it("falls back to Site N by ranking", () => {
    expect(buildSiteLabels(["a", "b"], { b: " 5 Elm " })).toEqual({
      a: "Site 1",
      b: "5 Elm",
    });
  });

  it("writes plain status sentences", () => {
    expect(
      statusSentence("recommended", { recommended: "12 Main St", tied: [] }),
    ).toMatch(/^Recommended: 12 Main St\./);
    expect(
      statusSentence("tie", { recommended: null, tied: ["A", "B"] }),
    ).toMatch(/^A and B are effectively tied/);
    expect(
      statusSentence("no_site_meets_budget", { recommended: null, tied: [] }),
    ).toMatch(/budget limits/);
    expect(
      statusSentence("budget_unknown", { recommended: null, tied: [] }),
    ).toMatch(/provisional/);
  });

  it("humanizes jargon and ids together", () => {
    expect(
      humanizeText(
        "40263575:20962385: Scenario intervals overlap; the ranking is not a meaningful separation. [comparison:c]",
        labels,
      ),
    ).toBe(
      "12 Main St: The ranges overlap, so these two are effectively tied.",
    );
  });
});
