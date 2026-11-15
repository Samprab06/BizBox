import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/simulator/demo", () => ({
  SimulatorDemo: () =>
    h("div", { "data-real-counter-replay": true }, "Existing counter replay"),
}));
import { ReferenceCafeStage } from "./reference-cafe-stage";
const props = {
  projectId: "project-a",
  selectedAddress: "Houston selected unit",
  reference: { selectedPlan: 1 as const, reviewed: false },
  onReferenceChange: () => {},
  children: h("p", null, "Furniture proposal"),
};
describe("reference café within main interior stage", () => {
  it("keeps the reference and furniture surfaces mounted across view switches", () => {
    const html = renderToStaticMarkup(h(ReferenceCafeStage, props));
    expect(html).toContain("data-reference-view");
    expect(html).toMatch(/<div[^>]*hidden=""[^>]*data-furniture-view/);
    expect(html).toContain("<p>Furniture proposal</p>");
  });
  it("shows the actual public reference embed without claiming it is the selected unit", () => {
    const html = renderToStaticMarkup(h(ReferenceCafeStage, props));
    expect(html).toContain("qfmMbTLt4Bo");
    expect(html).toContain("Houston selected unit");
    expect(html).toContain("Reference café");
    expect(html).toContain("not the selected property");
    expect(html).toContain("SDK key is unavailable");
    expect(html).toContain("Existing counter replay");
  });
  it("uses approved SDK replay config without adding a duplicate public iframe", () => {
    const html = renderToStaticMarkup(
      h(ReferenceCafeStage, {
        ...props,
        matterport: { sdkKey: "domain-key", modelId: "qfmMbTLt4Bo" },
      }),
    );
    expect(html).not.toContain("SDK key is unavailable");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Existing counter replay");
  });
});
