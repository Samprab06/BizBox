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
  LocationQuestion,
  CounterQuestion,
  interiorFrame,
} from "./story-scenes";
const data = createLocationStory();
describe("prepared location-story presentation", () => {
  it("keeps a scrolled preview in viewport coordinates and fills the resized viewport on expansion", () => {
    const source = { left: 20, top: 312, width: 350, height: 136 };
    expect(interiorFrame(source, { width: 390, height: 700 }, 0)).toMatchObject(
      source,
    );
    expect(interiorFrame(source, { width: 390, height: 700 }, 1)).toEqual({
      left: 0,
      top: 0,
      width: 390,
      height: 700,
    });
    expect(interiorFrame(source, { width: 700, height: 390 }, 1)).toEqual({
      left: 0,
      top: 0,
      width: 700,
      height: 390,
    });
    expect(interiorFrame(source, { width: 700, height: 390 }, 0)).toMatchObject(
      source,
    );
  });
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
    const primary = html.split("<details")[0];
    expect(primary).not.toContain("assumed arrivals");
    expect(primary).not.toContain("/ month rent");
    expect(primary).toContain('data-result-chart="contribution"');
  });
  it("composes the consultant question before sending, then distinguishes the user from BizBox and embeds See inside in its reply", () => {
    const initial = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 200, reduced: false }),
    );
    const typed = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 20000, reduced: false }),
    );
    expect(initial).toContain("<textarea");
    expect(initial).toContain('aria-label="Consultant question"');
    expect(initial).not.toContain('data-speaker="user"');
    expect(initial).not.toContain('data-speaker="bizbox"');
    expect(typed).toContain('data-speaker="user"');
    expect(typed).toContain('data-speaker="bizbox"');
    expect(typed).toContain("higher rent");
    expect(typed).toContain('data-interior-preview="true"');
    expect(typed).toContain("See inside");
    expect(
      typed.match(
        /alt="Generated example café with green tile and walnut furniture"/g,
      ),
    ).toHaveLength(1);
    expect(initial).toContain("Example consultant recommendation");
    const reduced = renderToStaticMarkup(
      h(ConsultantScene, { data, elapsed: 0, reduced: true }),
    );
    expect(reduced).toContain('data-speaker="bizbox"');
    expect(reduced).toContain("higher rent");
  });
  it.each(["location", "counter"] as const)(
    "uses a composer before separate user and BizBox messages for %s",
    (kind) => {
      const render = (elapsed: number) =>
        renderToStaticMarkup(
          kind === "location"
            ? h(LocationQuestion, { elapsed, reduced: false })
            : h(CounterQuestion, { demo: DEMO, elapsed, reduced: false }),
        );
      const initial = render(500);
      expect(initial).toContain("<textarea");
      expect(initial).toContain(
        `aria-label="${kind === "location" ? "Location" : "Counter"} question"`,
      );
      expect(initial).toContain('aria-label="Send example prompt"');
      expect(initial).not.toContain('data-speaker="bizbox"');
      const sent = render(20000);
      expect(sent).toContain('data-speaker="user"');
      expect(sent).toContain('data-speaker="bizbox"');
      expect(sent.indexOf('data-speaker="user"')).toBeLessThan(
        sent.indexOf('data-speaker="bizbox"'),
      );
      if (kind === "counter") {
        expect(sent).toContain("110-customer morning");
        expect(sent).toContain("$72 in labor");
        expect(sent).toContain("$6,000 in setup");
      }
    },
  );
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
