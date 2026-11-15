import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SimulatorDemo } from "./demo";
import { demoPlan, makeDemo } from "./fixture";

vi.mock("@/lib/client/use-workspace-context", () => ({
  useWorkspaceReport: () => {},
}));

it("uses the served-customer change in both the decision headline and tile", () => {
  const html = renderToStaticMarkup(
    createElement(SimulatorDemo, {
      data: makeDemo(),
      plan: demoPlan,
      projectId: "houston-coffee",
      context: {
        kind: "simulator",
        phase: "example",
        siteId: "montrose",
        synthetic: true,
      },
    }),
  );

  const headlineCount = html.match(
    /(\d+) more modeled customers per weekday/,
  )?.[1];
  const tileCount = html.match(
    /Change in modeled customers served \/ weekday<\/dt><dd[^>]*>\+(\d+)<\/dd>/,
  )?.[1];
  expect(headlineCount).toBe("25");
  expect(tileCount).toBe(headlineCount);
});
