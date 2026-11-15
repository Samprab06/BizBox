import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { makeDemo } from "@/components/simulator/fixture";
import { StatsCard, type StatsCardProps } from "./stats-card";

const run = makeDemo()[0].run;
const props: StatsCardProps = {
  run,
  scope: "site",
  minute: 500,
  playing: false,
  speed: 6,
  onScopeChange() {},
  onMinuteChange() {},
  onPlayingChange() {},
  onSpeedChange() {},
};

it("associates the seek control with its label and qualifies modeled metrics", () => {
  const html = renderToStaticMarkup(createElement(StatsCard, props));
  expect(html).toContain('aria-label="Modeled day statistics"');
  expect(html).toContain("Simulation</span>");
  expect(html).toContain("Completed services only · USD");
  expect(html).toContain("Elapsed wait among customers still in line");
  expect(html).toContain('aria-label="Play playback"');
  expect(html).toContain('aria-valuetext="08:20"');
  expect(html).toMatch(
    /<label[^>]*for="([^"]+)"[^>]*>Seek local time<\/label><input[^>]*id="\1"/,
  );
});

it("disables unavailable area data and does not present a site total as area statistics", () => {
  const html = renderToStaticMarkup(
    createElement(StatsCard, { ...props, scope: "area", playing: true }),
  );
  expect(html).toMatch(/aria-pressed="true"[^>]*>This site/);
  expect(html).toMatch(/aria-pressed="false" disabled=""[^>]*>Area overview/);
  expect(html).toContain('aria-label="Pause playback"');
});

it("keeps purchase points on the same scale as playback advances", () => {
  const pointsAt = (minute: number) => {
    const html = renderToStaticMarkup(
      createElement(StatsCard, { ...props, minute }),
    );
    return html.match(/<polyline points="([^"]+)"/)![1].split(" ");
  };
  const early = pointsAt(600).slice(0, -1);
  expect(early.length).toBeGreaterThan(1);
  expect(pointsAt(run.metrics.closeMin).slice(0, early.length)).toEqual(early);
});
