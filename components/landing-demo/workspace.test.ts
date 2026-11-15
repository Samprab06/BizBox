import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEMO } from "./demo-data";
import { Workspace } from "./workspace";
import { chapterAt } from "./timeline";

const noop = () => {};
describe("counter artwork selection", () => {
  it.each([
    {
      choice: "current" as const,
      file: "cafe-overhead-one-counter-v2.png",
      hidden: "cafe-overhead-two-counters-v3.png",
    },
    {
      choice: "proposed" as const,
      file: "cafe-overhead-two-counters-v3.png",
      hidden: "cafe-overhead-one-counter-v2.png",
    },
  ])(
    "keeps the $choice checkout count through full-screen and closing MacBook",
    ({ choice, file, hidden }) => {
      for (const progress of [0.74, 0.99]) {
        const html = renderToStaticMarkup(
          h(Workspace, {
            demo: DEMO,
            frame: chapterAt(progress),
            choice,
            reduced: false,
            area: "montrose",
            mini: progress > 0.9,
            running: true,
            flowPaused: false,
            onArea: noop,
            onProperty: noop,
            onInterior: noop,
            onExperiment: noop,
            onChoice: noop,
            onFlow: noop,
            onReplay: noop,
          }),
        );
        const tags = html.match(/<div[^>]*data-artwork="[^"]*"[^>]*>/g) ?? [];
        const visible = tags.find((tag) =>
          tag.includes(`data-artwork="${file}"`),
        );
        const inactive = tags.find((tag) =>
          tag.includes(`data-artwork="${hidden}"`),
        );
        expect(visible).toContain("opacity:1");
        expect(visible).toContain('aria-hidden="false"');
        expect(inactive).toContain("opacity:0");
        expect(inactive).toContain('aria-hidden="true"');
      }
    },
  );
});

describe("shortlist property facts", () => {
  it("shows the same rent, size and area fields for The Heights", () => {
    const html = renderToStaticMarkup(
      h(Workspace, {
        demo: DEMO,
        frame: chapterAt(0.4),
        choice: "current",
        reduced: false,
        area: "heights",
        mini: false,
        running: false,
        flowPaused: false,
        onArea: noop,
        onProperty: noop,
        onInterior: noop,
        onExperiment: noop,
        onChoice: noop,
        onFlow: noop,
        onReplay: noop,
      }),
    );
    expect(html).toContain("$3,400");
    expect(html).toContain("1,350");
    expect(html).toContain("Rent assumption");
    expect(html).toContain("Floor area");
    expect(html).toContain("Continue with Montrose");
    expect(html).not.toContain("Context candidate");
  });
});
