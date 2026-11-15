import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeDemo } from "@/components/simulator/fixture";
import { InspectPanel, type InspectPanelProps } from "./inspect-panel";

const run = makeDemo()[0].run;
const done = run.events.find((e) => e.type === "completion")!;
const id = done.customerId;
const start = run.events.find(
  (e) => e.type === "service_start" && e.customerId === id,
)!;
const render = (props: Partial<InspectPanelProps>) =>
  renderToStaticMarkup(
    createElement(InspectPanel, {
      events: run.events,
      minute: run.metrics.closeMin,
      selectedId: id,
      onSelect() {},
      ...props,
    }),
  );

describe("InspectPanel", () => {
  it("labels its search, list and follow control for keyboard and screen readers", () => {
    const html = render({ onFollowChange() {}, following: true });
    expect(html).toContain('aria-label="Inspect customers"');
    expect(html).toMatch(/<label[^>]*>Search customers<input type="search"/);
    expect(html).toMatch(/<label[^>]*>Inspect a customer<select/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Stop following");
    expect(html).toContain("Esc stops following");
  });

  it("explains when Follow is unavailable", () => {
    const html = render({ followUnavailableReason: "no street geometry" });
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain("Follow unavailable: no street geometry");
  });

  it("shows the outcome only after it happens when seeking back", () => {
    const during = render({ minute: (start.timeMin + done.timeMin) / 2 });
    expect(during).toContain("In service");
    expect(during).toContain("Not decided yet at this time");
    expect(during).not.toContain(">Served<");
    const after = render({ minute: done.timeMin });
    expect(after).toContain(">Served<");
    const before = render({ minute: run.metrics.openMin - 1 });
    expect(before).toContain("has not arrived by");
    expect(before).not.toContain("Stay probability at arrival");
  });

  it("lists only arrived customers and shows missing metadata explicitly", () => {
    const minute = run.metrics.openMin + 10;
    const html = render({ minute, selectedId: "" });
    const arrived = run.events.filter(
      (e) => e.type === "arrival" && e.timeMin <= minute,
    ).length;
    expect(html.match(/<option value="customer-/g) ?? []).toHaveLength(arrived);
    const card = render({});
    expect(card).toContain(
      "Kind, income, age and kids not supplied for this persona",
    );
    expect(card).toContain("travel mode unavailable");
    expect(card).toContain("Origin distance unavailable (no trip geometry)");
    expect(card).toContain(
      "No customer-panel answers for this persona in this run",
    );
  });
});
