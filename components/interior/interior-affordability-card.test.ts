import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteriorAffordabilityCard } from "./interior-affordability-card";
it("gates the read-only check on current review and labels unknown sandbox costs", () => {
  const html = renderToStaticMarkup(
    createElement(InteriorAffordabilityCard, {
      reviewed: false,
      onCheck: () => {
        throw new Error("render must never request bank data");
      },
    }),
  );
  expect(html).toContain("disabled");
  expect(html).toContain("simulated banking sandbox");
  expect(html).toContain("Furniture prices");
  expect(html).toContain("Review the current interior run");
});
it("shows unconfigured and provider errors without inventing a balance", () => {
  const html = renderToStaticMarkup(
    createElement(InteriorAffordabilityCard, {
      reviewed: true,
      onCheck: () => {},
      error: "Sandbox account is unconfigured",
    }),
  );
  expect(html).toContain("Sandbox account is unconfigured");
  expect(html).not.toContain("Available cash");
  expect(html).not.toContain("disabled");
});
it("renders a report-only section without a check action", () => {
  const html = renderToStaticMarkup(
    createElement(InteriorAffordabilityCard, { reviewed: true }),
  );
  expect(html).not.toContain("<button");
});
