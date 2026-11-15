import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stationPlan } from "@/tests/e2e/station-experiment-fixtures";
import { FounderCounters } from "./station-callout-controller";

const base = {
  loading: false,
  writing: false,
  error: null,
  needsRead: false,
  onRun: () => {},
  onRetry: () => {},
};

describe("founder counters panel", () => {
  it("shows plain copy and no developer text", () => {
    const html = renderToStaticMarkup(
      h(FounderCounters, { ...base, visible: stationPlan(3), completed: 3 }),
    );
    expect(html).toContain("See how adding a counter");
    expect(html).toContain("3 of 3 setups done");
    expect(html).toContain("staff on shift");
    expect(html).toContain("Today:");
    expect(html).toContain("Best option:");
    for (const bad of [
      "paired seeds",
      "Saved comparison",
      "profile_",
      "budget units",
      "planned /",
      "Refresh station progress",
      "Compare setups",
      "succeeded",
      "Assumption",
    ])
      expect(html).not.toContain(bad);
  });
  it("offers the run button before anything has run", () => {
    const html = renderToStaticMarkup(
      h(FounderCounters, { ...base, visible: stationPlan(0), completed: 0 }),
    );
    expect(html).toContain("Run the counter test");
    expect(html).not.toContain("planned");
  });
});
