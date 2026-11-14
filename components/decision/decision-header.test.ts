import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionHeader } from "./decision-header";

describe("decision reading order", () => {
  it("keeps the supplied qualified answer before the scene and next action", () => {
    const html = renderToStaticMarkup(
      h(DecisionHeader, {
        decision: "Which site holds its lead if demand changes?",
        answer: "Site A leads; Site B leads below 0.70× demand.",
        qualification: h(
          "p",
          null,
          "Modelled, not observed. Jev and Huff disagree.",
        ),
        scene: h("div", null, "Stored replay"),
        nextAction: h("button", { type: "button" }, "Change market share"),
      }),
    );
    expect(html).toContain('aria-label="Recommendation robustness"');
    const phrases = [
      "Which site",
      "Site A leads",
      "Modelled, not observed",
      "Stored replay",
      "Change market share",
    ];
    for (let i = 1; i < phrases.length; i++) {
      expect(html.indexOf(phrases[i])).toBeGreaterThan(
        html.indexOf(phrases[i - 1]),
      );
    }
    expect(html).not.toContain("line-clamp");
  });

  it("allows an honest unavailable answer without inventing a scene", () => {
    const html = renderToStaticMarkup(
      h(DecisionHeader, {
        decision: "Which site should I shortlist?",
        answer: "Robustness is unavailable for this saved comparison.",
        qualification: "Review the modeled ranges and assumptions.",
        nextAction: h("a", { href: "#evidence" }, "Open evidence"),
      }),
    );
    expect(html).toContain("Robustness is unavailable");
    expect(html).toContain('href="#evidence"');
    expect(html).not.toContain("Stored replay");
  });
});
