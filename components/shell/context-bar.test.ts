import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getPreviewProject } from "@/lib/workspace-preview";
import { resolveWorkspaceContext } from "@/lib/client/workspace-context";
import { ContextBar, ProjectContextBar } from "./context-bar";

const model = resolveWorkspaceContext({
  project: getPreviewProject("houston-coffee")!,
  pathname: "/projects/houston-coffee/intake",
  search: "site=montrose",
  concept: "My café",
  observations: [],
});

describe("ContextBar", () => {
  it("shows the four context fields, display-only, in an accessible native disclosure", () => {
    const html = renderToStaticMarkup(h(ContextBar, { model }));
    expect(html).toContain('aria-label="Project context"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Business concept");
    expect(html).toContain("Selected location");
    expect(html).toContain("Scenario");
    expect(html).toContain("Data and model");
    expect(html).toContain("My café");
    expect(html).toContain("Example</span>");
    // Scene 1: the stepper is the only navigation, so the bar has no links.
    expect(html).not.toContain("<a ");
    expect(model.concept.href).toBe(
      "/projects/houston-coffee/intake?site=montrose",
    );
    expect(model.status.href).toContain("#listing-source");
  });
  it("never renders an Example badge for verified live context", () => {
    const html = renderToStaticMarkup(
      h(ContextBar, {
        model: {
          ...model,
          example: false,
          status: { text: "Live comparison", href: model.status.href },
          qualifier: "Modeled, not a forecast",
        },
      }),
    );
    expect(html).not.toContain("Example</span>");
    expect(html).toContain("Live comparison");
    expect(html).toContain("Modeled, not a forecast");
  });
});

it("keeps the optional context-bar consumer inert outside its project registry", () => {
  expect(renderToStaticMarkup(h(ProjectContextBar))).toBe("");
});
