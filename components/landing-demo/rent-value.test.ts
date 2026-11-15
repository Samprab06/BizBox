import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RentValue } from "./rent-value";

describe("visible rent first frame", () => {
  it("starts each newly focused presentation at one instead of a stale final value", () => {
    for (let i = 0; i < 2; i++) {
      const html = renderToStaticMarkup(
        h(RentValue, { target: 3000, animate: true, reduced: false }),
      );
      expect(html).toContain('data-rent-value="1"');
      expect(html).toContain("$1");
    }
  });
  it("shows prepared final values without animation for reduced motion and shortlist context", () => {
    for (const props of [
      { animate: true, reduced: true },
      { animate: false, reduced: false },
    ]) {
      const html = renderToStaticMarkup(
        h(RentValue, { target: 3000, ...props }),
      );
      expect(html).toContain('data-rent-value="3000"');
      expect(html).toContain("$3,000");
    }
  });
});
