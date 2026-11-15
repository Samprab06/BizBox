import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlowStepperView, stepperItems } from "./flow-stepper";

const project = "p-0123456789abcdef0123";

describe("stepperItems", () => {
  it("lists the five flow steps in order, numbered from 1", () => {
    const items = stepperItems(project, { reached: [] }, null);
    expect(items.map((item) => [item.number, item.id, item.label])).toEqual([
      [1, "questions", "Your business"],
      [2, "locations", "Top locations"],
      [3, "compare", "Compare"],
      [4, "results", "Results & refine"],
      [5, "finalize", "Final plan"],
    ]);
  });

  it("on a first visit only the questions open; every later step is locked", () => {
    const items = stepperItems(project, { reached: ["questions"] }, "questions");
    expect(items.map((item) => item.status)).toEqual([
      "current",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
    expect(items[0]!.href).toBe(`/projects/${project}/intake`);
    expect(items.slice(1).every((item) => item.href === null)).toBe(true);
  });

  it("links every reached step and marks the one the URL shows as current", () => {
    const items = stepperItems(
      project,
      { reached: ["questions", "locations", "compare"] },
      "locations",
    );
    expect(items.map((item) => item.status)).toEqual([
      "reached",
      "current",
      "reached",
      "locked",
      "locked",
    ]);
    expect(items.map((item) => item.href)).toEqual([
      `/projects/${project}/intake`,
      `/projects/${project}/workspace?step=locations`,
      `/projects/${project}/workspace?step=compare`,
      null,
      null,
    ]);
  });

  it("keeps the step the URL shows openable even before the store records it", () => {
    const items = stepperItems(project, { reached: [] }, "results");
    expect(items[3]).toMatchObject({
      status: "current",
      href: `/projects/${project}/workspace?step=results`,
    });
    // Questions are always reachable; the steps in between are not implied by the URL.
    expect(items.map((item) => item.status)).toEqual([
      "reached",
      "locked",
      "locked",
      "current",
      "locked",
    ]);
  });

  it("a page outside the flow (e.g. /plan) has no current step", () => {
    const items = stepperItems(
      project,
      { reached: ["questions", "locations"] },
      null,
    );
    expect(items.some((item) => item.status === "current")).toBe(false);
  });
});

describe("FlowStepperView", () => {
  const html = renderToStaticMarkup(
    h(FlowStepperView, {
      items: stepperItems(
        project,
        { reached: ["questions", "locations"] },
        "locations",
      ),
    }),
  );

  it("renders an ordered list inside a labelled navigation landmark", () => {
    expect(html).toMatch(/^<nav aria-label="Progress"/);
    expect(html.match(/<li /g)).toHaveLength(5);
    expect(html).toContain("<ol");
  });

  it("marks the current step with aria-current and links reached steps", () => {
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    const current = html.match(/<a [^>]*aria-current="step"[^>]*>/)?.[0];
    expect(current).toContain(
      `href="/projects/${project}/workspace?step=locations"`,
    );
    expect(html).toContain(`href="/projects/${project}/intake"`);
  });

  it("shows locked steps as disabled text, not links", () => {
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
    expect(html).not.toContain("step=compare");
    expect(html).not.toContain("step=results");
    expect(html).not.toContain("step=finalize");
    expect(html.match(/\(not reached yet\)/g)).toHaveLength(3);
  });

  it("keeps every label in the accessible text, even where it is collapsed", () => {
    for (const label of [
      "Your business",
      "Top locations",
      "Compare",
      "Results &amp; refine",
      "Final plan",
    ])
      expect(html).toContain(label);
  });
});
