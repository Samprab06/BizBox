import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createLocationStory } from "./location-data";
import { DEMO } from "../landing-demo/demo-data";
import {
  LocationAnalytics,
  ConsultantScene,
  CounterComparison,
  MorningScene,
} from "./story-scenes";
const data = createLocationStory();
describe("prepared location-story presentation", () => {
  it("shows engine-backed same-morning values without putting the map in analytics", () => {
    const html = renderToStaticMarkup(h(LocationAnalytics, { data }));
    for (const site of data.sites) {
      expect(html).toContain(`<strong>${site.served}</strong>`);
      expect(html).toContain(site.name);
    }
    const money = (value: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    for (const site of data.sites) {
      expect(html).toContain(money(site.contributionUsd));
      expect(html).toContain(`${site.arrivals} assumed arrivals`);
      expect(html).toContain(`${money(site.rent)} / month rent`);
    }
    const [winner, other] = [...data.sites].sort(
      (a, b) => b.contributionUsd - a.contributionUsd,
    );
    expect(html).toContain(
      money(winner.contributionUsd - other.contributionUsd),
    );
    expect(html.match(/<dl/g)).toHaveLength(2);
    expect(html).toContain("Assumptions &amp; costs");
    expect(html).not.toContain("canvas");
    expect(html).not.toContain("iframe");
  });
  it("shows the consultant bubble before typing, then reveals the prepared recommendation", () => {
    const initial = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 200, reduced: false }),
    );
    const typed = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 20000, reduced: false }),
    );
    const visible = (html: string) =>
      html.match(/<p aria-hidden="true">([\s\S]*?)<span/)?.[1];
    expect(visible(initial)).toBe("");
    expect(visible(typed)).toContain("higher rent");
    expect(initial).toContain("Example consultant recommendation");
    const reduced = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 0, reduced: true }),
    );
    expect(visible(reduced)).toContain("higher rent");
  });
  it("shows each counter result together but keeps secondary metrics behind Details", () => {
    const html = renderToStaticMarkup(
      h(CounterComparison, {
        demo: DEMO,
        running: false,
        choice: "proposed",
        onChoice: () => {},
      }),
    );
    const primary = html.split("<details")[0];
    expect(primary).toContain("<strong>55</strong>");
    expect(primary).toContain("<strong>80</strong>");
    expect(primary).toContain("<dd>+25</dd>");
    expect(primary).toContain("<dd>+$72</dd>");
    expect(primary).toContain("<dd>+$6,000</dd>");
    for (const label of ["customers", "morning labor", "setup"])
      expect(primary).toContain(`<dt>${label}</dt>`);
    expect(primary).not.toContain("P90");
    expect(html).toContain("20.2");
    expect(html).toContain("6.8");
    expect(html.match(/data-counter="/g)).toHaveLength(3);
  });
  it.each(["current", "proposed"] as const)(
    "retains only selected %s artwork/results in the closing Mac",
    (choice) => {
      const html = renderToStaticMarkup(
        h(CounterComparison, {
          demo: DEMO,
          running: false,
          choice,
          onChoice: () => {},
          mini: true,
        }),
      );
      expect(html.match(/customers served/g)).toHaveLength(1);
      expect(html).toContain(
        `<strong>${DEMO.experiment[choice].served}</strong>`,
      );
      expect(html.match(/data-counter="/g)).toHaveLength(
        choice === "current" ? 1 : 2,
      );
      expect(html).not.toContain("more in morning labor");
    },
  );
  it("keeps only the clock/qualification so the anchored simulation chips remain visible", () => {
    const html = renderToStaticMarkup(
      h(MorningScene, { data, elapsed: 6000, reduced: false }),
    );
    expect(html).toContain("12:00 PM");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("demandBar");
    expect(html).toContain("not measured footfall");
  });
});
