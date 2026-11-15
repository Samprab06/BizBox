import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FinalPlanSummarySchema,
  type FinalPlanSummary,
} from "@/lib/contracts/plan";
import { runnerUpGap } from "@/lib/client/final-plan";
import { EMPTY_MESSAGE, MODELED_NOTE, PlanSummary } from "./plan-summary";

const summary: FinalPlanSummary = FinalPlanSummarySchema.parse({
  projectId: "p 1",
  comparisonId: "cmp-1",
  chosenSiteId: "prop:unit-1",
  chosenAddress: "100 Main St, Unit 1",
  rationale: "Strongest weekday mornings and the lowest rent.",
  finalizedAt: "2026-11-15T14:30:00.000Z",
  demandSource: "jev",
  metrics: {
    monthlyServedCustomers: { mean: 3120, low: 2800, high: 3400 },
    monthlyContributionUsd: { mean: 8400, low: -600, high: 12_000 },
    weekdayMeanWaitMin: { mean: 3.4, low: 1.2, high: 6.8 },
  },
  tweaks: {
    hours: { openMinute: 420, closeMinute: 1140 },
    priceUsd: 6.5,
    staff: 3,
    monthlyRentUsd: 4200,
  },
  runnerUp: {
    siteId: "prop:unit-2",
    address: "200 Elm St, Unit 3",
    monthlyContributionUsd: { mean: 6100, low: 3000, high: 9000 },
  },
  risks: ["In weaker modeled scenarios the site loses money."],
  nextSteps: ["Tour the unit.", "Negotiate the rent target."],
});

const render = (props: Parameters<typeof PlanSummary>[0]) =>
  renderToStaticMarkup(createElement(PlanSummary, props));

describe("PlanSummary", () => {
  it("shows the hero, metric cards, tweaks, runner-up, risks, steps and export link", () => {
    const html = render({ projectId: "p 1", summary });
    expect(html).toContain('data-agent-anchor="plan_summary"');
    expect(html).toMatch(/<h2 id="([^"]+)"[^>]*>100 Main St, Unit 1<\/h2>/);
    expect(html).toContain("Recommended");
    expect(html).toContain("Strongest weekday mornings and the lowest rent.");
    // Three cards, each labelled as modeled.
    expect(html.split(MODELED_NOTE).length - 1).toBe(3);
    expect(html).toContain("3,120");
    expect(html).toContain("2,800–3,400");
    expect(html).toContain("$8,400");
    expect(html).toContain("-$600–$12,000");
    expect(html).toContain("3.4 min");
    expect(html).toContain("1.2 min–6.8 min");
    // Tweaks.
    expect(html).toContain("7:00 AM–7:00 PM");
    expect(html).toContain("$6.50");
    expect(html).toContain("3 people per open hour");
    expect(html).toContain("$4,200 / month");
    // Runner-up.
    expect(html).toContain("200 Elm St, Unit 3");
    expect(html).toContain("Chosen leads by +$2,300 / month");
    expect(html).toContain("the ranges overlap");
    // Risks and numbered steps with labelled checkboxes.
    expect(html).toContain("In weaker modeled scenarios the site loses money.");
    expect(html).toMatch(
      /<input id="([^"]+)" type="checkbox"[^>]*\/><label for="\1">Tour the unit\.<\/label>/,
    );
    expect(html).toContain("<ol");
    // Footer.
    expect(html).toContain('href="/projects/p%201/plan?comparison=cmp-1"');
    expect(html).toContain("Print / export full plan");
    expect(html).toContain('dateTime="2026-11-15T14:30:00.000Z"');
    expect(html).toContain("Nov 15, 2026");
    // Accessible structure.
    for (const heading of [
      "Modeled outlook",
      "Applied changes",
      "Runner-up",
      "Risks to watch",
      "Next steps",
    ])
      expect(html).toMatch(new RegExp(`<h3 id="[^"]+"[^>]*>${heading}</h3>`));
  });

  it("omits tweaks and handles a missing runner-up, wait and risks", () => {
    const html = render({
      projectId: "p",
      summary: {
        ...summary,
        tweaks: undefined,
        runnerUp: null,
        risks: [],
        metrics: { ...summary.metrics, weekdayMeanWaitMin: undefined },
      },
    });
    expect(html).not.toContain("Applied changes");
    expect(html).toContain("No other location was compared");
    expect(html).toContain("No major risks stood out");
    expect(html).toContain("Not modeled");
  });

  it("shows the empty state when there is no stored plan", () => {
    const html = render({ projectId: "p 1" });
    expect(html).toContain('data-agent-anchor="plan_summary"');
    expect(html).toContain(EMPTY_MESSAGE);
    expect(html).toContain('href="/projects/p%201/workspace?step=results"');
  });
});

describe("runnerUpGap", () => {
  it("reports the mean difference and whether the ranges overlap", () => {
    expect(runnerUpGap(summary)).toEqual({
      difference: 2300,
      overlapping: true,
    });
    expect(
      runnerUpGap({
        ...summary,
        runnerUp: {
          ...summary.runnerUp!,
          monthlyContributionUsd: { mean: 100, low: -1000, high: -700 },
        },
      }),
    ).toEqual({ difference: 8300, overlapping: false });
    expect(runnerUpGap({ ...summary, runnerUp: null })).toBeNull();
  });
});
