import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiffCard as DiffCardModel } from "./controller";
import { DiffCard } from "./diff-card";

const card = (overrides: Partial<DiffCardModel> = {}): DiffCardModel => ({
  callId: "call-1",
  tool: "set_hours",
  scenarioId: "s1",
  parentId: "base",
  label: null,
  rationale: "Try opening at 6am",
  sites: { added: ["heights"], removed: [] },
  changedPaths: ["overrides.hours.weekday.openMinute"],
  run: "not_run",
  executionId: null,
  comparisonId: null,
  metrics: null,
  decision: { state: "proposed" },
  ...overrides,
});

const render = (model: DiffCardModel) =>
  renderToStaticMarkup(
    createElement(DiffCard, {
      projectId: "houston-coffee",
      card: model,
      active: false,
      onKeep: () => {},
      onRevert: () => {},
    }),
  );

describe("DiffCard markup", () => {
  it("uses native, labelled controls so the card is keyboard operable", () => {
    const html = render(card());
    expect(html).toMatch(/<article aria-labelledby="[^"]+"/);
    expect(html).toContain('<button type="button" class="');
    expect(html).toContain('aria-label="Keep: Changed opening hours"');
    expect(html).toContain('aria-label="Revert: Changed opening hours"');
    expect(html).toContain('href="/projects/houston-coffee/simulator"');
    expect(html).not.toMatch(/tabindex="-1"/);
    expect(html).toContain("Weekday opening time");
    expect(html).toContain("Added sites: heights");
    expect(html).toContain("Metric deltas appear once");
  });

  it("disables both decisions once reverted and names the revert version", () => {
    const html = render(
      card({ decision: { state: "reverted", revertScenarioId: "s9" } }),
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("revert version (s9)");
  });

  it("links the city view to the run's comparison and shows deltas with origins", () => {
    const html = render(
      card({
        run: "succeeded",
        comparisonId: "c1",
        metrics: [
          {
            key: "wait",
            label: "Average wait",
            unit: "min",
            before: 4,
            after: 3,
            origin: "simulation",
          },
        ],
      }),
    );
    expect(html).toContain(
      'href="/projects/houston-coffee/simulator?comparison=c1"',
    );
    expect(html).toContain("(simulation)");
    expect(html).toContain("−1 min");
  });
});
