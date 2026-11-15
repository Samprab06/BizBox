import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSpatialDraft } from "@/lib/spatial";
import type { InteriorFlowState } from "@/lib/client/flow-steps";
import { SelectedSiteInteriorStage } from "./selected-site-interior-stage";
const draft = createSpatialDraft({
  projectId: "p",
  siteId: "1:2",
  city: "los_angeles",
});
const base: InteriorFlowState = {
  comparisonId: "c",
  siteId: "1:2",
  baseline: draft,
  draft,
  ranRevision: null,
  reviewedRevision: null,
};
const callbacks = {
  onResolved: () => {},
  onCommand: () => {},
  onRun: () => {},
  onReview: () => {},
  onFinalize: () => {},
  onBack: () => {},
  error: null,
  address: "Chosen building",
};
it("opens the selected Matterport model directly without any modeled view or catalog panel", () => {
  const html = renderToStaticMarkup(
    createElement(SelectedSiteInteriorStage, {
      ...callbacks,
      interior: {
        ...base,
        source: {
          kind: "scan",
          modelId: "Synthetic01",
          provenance: {
            origin: "costar",
            provider: "matterport",
            mode: "live",
            scope: "property",
            description: "Public selected scan",
            limitations: [],
          },
        },
      },
    }),
  );
  expect(html).toContain("m=Synthetic01");
  expect(html).toContain("Building reference");
  expect(html).not.toContain("Experiment layout");
  expect(html).not.toContain("Furniture catalog");
  expect(html).not.toContain("3D furniture");
  expect(html).not.toContain("Proposed interior floor plan");
});
it("shows a concise unavailable message instead of substituting a modeled room", () => {
  const html = renderToStaticMarkup(
    createElement(SelectedSiteInteriorStage, {
      ...callbacks,
      interior: {
        ...base,
        source: {
          kind: "modeled",
          provenance: {
            origin: "default",
            provider: "modeled",
            mode: "live",
            scope: "space",
            description: "No scan",
            limitations: [],
          },
        },
      },
    }),
  );
  expect(html).toContain("No viewable interior is available");
  expect(html).not.toContain("Building reference");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("<canvas");
  expect(html).not.toContain("Furniture catalog");
});
