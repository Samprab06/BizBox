import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiffCard as DiffCardModel } from "./controller";
import { DiffCard } from "./diff-card";

const card = (overrides: Partial<DiffCardModel> = {}): DiffCardModel => ({
  proposalId: "call-1",
  tool: "set_hours",
  title: "Changed opening hours",
  description: "Review the set_hours change before running or keeping it.",
  baseScenarioId: "base",
  proposedScenarioId: "s1",
  sites: { added: ["heights"], removed: [] },
  changedPaths: ["overrides.hours.weekday.openMinute"],
  status: "pending",
  run: "not_run",
  comparisonId: null,
  pending: null,
  error: null,
  revertScenarioId: null,
  revertVersionFailed: false,
  ...overrides,
});

const render = (model: DiffCardModel) =>
  renderToStaticMarkup(
    createElement(DiffCard, {
      projectId: "houston-coffee",
      card: model,
      active: false,
      onAction: () => {},
      onRetryRevertVersion: () => {},
    }),
  );

describe("DiffCard markup", () => {
  it("uses native, labelled controls so the card is keyboard operable", () => {
    const html = render(card());
    expect(html).toMatch(/<article aria-labelledby="[^"]+"/);
    for (const action of ["Run", "Keep", "Revert"])
      expect(html).toContain(
        `<button type="button" class="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60" aria-label="${action}: Changed opening hours">`,
      );
    expect(html).toContain('href="/projects/houston-coffee/simulator"');
    expect(html).not.toMatch(/tabindex="-1"/);
    expect(html).not.toContain("disabled=");
    expect(html).toContain("Weekday opening time");
    expect(html).toContain("Added sites: heights");
    expect(html).toContain("Metric deltas appear once");
  });

  it("disables decisions once reverted and names the revert version", () => {
    const html = render(card({ status: "reverted", revertScenarioId: "s9" }));
    expect(html).not.toContain('aria-label="Run:');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("revert version (s9)");
  });

  it("offers a retry when only the revert version failed", () => {
    const html = render(
      card({
        status: "reverted",
        revertVersionFailed: true,
        error: "Scenario service is temporarily unavailable.",
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry saving the revert version");
  });

  it("links the finished run to its comparison and city view", () => {
    const html = render(card({ run: "succeeded", comparisonId: "c1" }));
    expect(html).toContain(
      'href="/projects/houston-coffee/comparison?comparison=c1"',
    );
    expect(html).toContain(
      'href="/projects/houston-coffee/simulator?comparison=c1"',
    );
  });
});
