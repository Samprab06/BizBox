import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "./card";
import { Stat } from "./stat";
import { GlassControl } from "./glass-control";
import { EvidenceBadge } from "./evidence-badge";

const render = renderToStaticMarkup;

describe("analysis primitives", () => {
  it("keeps a Card solid and forwards accessible labelling", () => {
    const html = render(
      h(Card, { "aria-label": "Costs", surface: "viewport" }, "Rent"),
    );
    expect(html).toContain('aria-label="Costs"');
    expect(html).toContain('data-surface="viewport"');
    expect(html).toContain("sw-card");
    expect(html).not.toContain("sw-glass-control");
  });

  it("associates a tabular value and adjacent evidence qualifier with its label", () => {
    const html = render(
      h(Stat, {
        label: "Monthly contribution",
        value: "$2,400–$3,100",
        qualifier: h(EvidenceBadge, { kind: "Simulation" }),
      }),
    );
    expect(html).toContain("<dl");
    expect(html).toContain("<dt>Monthly contribution</dt>");
    expect(html).toMatch(/<dd[^>]*sw-stat-value[^>]*>\$2,400–\$3,100<\/dd>/);
    expect(html).toMatch(/<dd[^>]*sw-stat-qualifier[^>]*>.*Simulation.*<\/dd>/);
  });

  it.each(["baseline", "alternative"] as const)(
    "names the %s scenario alongside the stat",
    (scenario) => {
      const html = render(h(Stat, { label: "Wait", value: "3 min", scenario }));
      expect(html).toContain(`sw-scenario-${scenario}`);
      expect(html).toContain(
        scenario === "baseline" ? "Baseline" : "Alternative",
      );
    },
  );

  it("restricts GlassControl to labelled controls floating over a spatial view", () => {
    const html = render(
      h(
        GlassControl,
        { over: "viewport", "aria-label": "View controls" },
        h("button", { type: "button" }, "Expand"),
      ),
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="View controls"');
    expect(html).toContain('data-surface="viewport"');
    expect(html).toContain("sw-glass-control");
    expect(html).toContain("<button");
  });

  it.each(["Source-backed", "Your input", "Assumption", "Simulation"] as const)(
    "shows %s in text without relying on color or a tooltip",
    (kind) => {
      const html = render(h(EvidenceBadge, { kind }));
      expect(html).toContain(`>${kind}</span>`);
      expect(html).not.toContain('role="status"');
      expect(html).not.toContain("title=");
    },
  );
});
