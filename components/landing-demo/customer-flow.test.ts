import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerFlow } from "./customer-flow";

describe("visible staffed-counter experiment", () => {
  it.each([
    { proposed: false, count: 1 },
    { proposed: true, count: 2 },
  ])("shows $count staffed checkout stations", ({ proposed, count }) => {
    const html = renderToStaticMarkup(
      h(CustomerFlow, { proposed, running: true }),
    );
    expect(html.match(/data-counter="/g)).toHaveLength(count);
    expect(html.match(/data-staff="/g)).toHaveLength(count);
    expect(html).toContain(`${count} staffed checkout`);
  });

  it.each([false, true])(
    "gives every customer a queue-to-service motion path (proposed=%s)",
    (proposed) => {
      const html = renderToStaticMarkup(
        h(CustomerFlow, { proposed, running: true }),
      );
      // Static staff and checkout markers are separate from customer circles.
      // The previous three/eight fixed queue dots had no animateMotion at all.
      const circles = [
        ...html.matchAll(
          /<circle\b[^>]*class="[^"]*customer[^" ]*[^"]*"[^>]*>([\s\S]*?)<\/circle>/g,
        ),
      ];
      expect(circles.length).toBeGreaterThan(3);
      for (const circle of circles) {
        expect(circle[1]).toContain("animateMotion");
        expect(circle[1]).toContain("keyPoints");
      }
      expect(html).not.toMatch(
        /<circle\b[^>]*\bcx="[^"]*"[^>]*class="[^"]*customer/,
      );
    },
  );
});
