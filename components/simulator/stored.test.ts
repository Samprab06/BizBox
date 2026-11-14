import { describe, expect, it } from "vitest";
import { fixture } from "@/lib/agent/__fixtures__/plan";
import { replayAt } from "../replay/replay-state";
import { engineEventsFromStored, storedSimulator } from "./stored";

describe("simulator from a stored comparison (HAC-63)", () => {
  const { comparison } = fixture();
  const { request, result } = comparison.evaluation;

  it("opens the chosen site's recorded weekday and weekend runs with provenance", () => {
    const leader = result.ranking[0]!;
    const out = storedSimulator({
      comparisonId: comparison.id,
      request,
      result,
      runs: comparison.runs,
    })!;
    expect(out).not.toBeNull();
    const site = result.sites.find((s) => s.siteId === leader)!;
    const weekday = comparison.runs.find(
      (r) => r.id === site.representative.weekday.runId,
    )!;
    // Converted events reproduce the stored run's outcomes.
    expect(out.data[0].run.metrics.served).toBe(
      weekday.metrics.completedCustomers,
    );
    expect(out.data[0].run.metrics.revenueUsd).toBe(
      weekday.metrics.revenueCents / 100,
    );
    expect(out.story.scenarioLabels).toEqual(["Weekday", "Weekend"]);
    expect(out.story.provenance?.label).toContain(comparison.id);
    expect(out.story.footnote).toMatch(/not a sales forecast/);
    expect(out.story.eyebrow).toMatch(/Stored comparison/);
    // The scene's replay can play the converted events to day end.
    const end = replayAt(out.data[0].run.events, 24 * 60);
    expect(end.served).toBe(weekday.metrics.completedCustomers);
  });

  it("keeps the selected property when asked, and returns null for missing runs", () => {
    const other = result.ranking[1]!;
    const out = storedSimulator({
      comparisonId: comparison.id,
      request,
      result,
      runs: comparison.runs,
      siteId: other,
    })!;
    expect(out.story.title).toBe(other);
    expect(
      storedSimulator({
        comparisonId: comparison.id,
        request,
        result,
        runs: [],
      }),
    ).toBeNull();
  });

  it("converts canonical events: balks are leave decisions, reneges become abandonment", () => {
    const events = engineEventsFromStored(
      [
        { customerId: "a", minute: 1, type: "arrived" },
        { customerId: "a", minute: 1, type: "joined" },
        { customerId: "b", minute: 2, type: "arrived" },
        { customerId: "b", minute: 2, type: "abandoned" },
        { customerId: "a", minute: 3, type: "served" },
        { customerId: "a", minute: 6, type: "departed" },
        { customerId: "c", minute: 4, type: "arrived" },
        { customerId: "c", minute: 4, type: "joined" },
        { customerId: "c", minute: 9, type: "abandoned" },
      ],
      6.5,
    );
    expect(events.map((e) => e.type)).toEqual([
      "arrival",
      "queue_entry",
      "arrival",
      "service_start",
      "arrival",
      "queue_entry",
      "completion",
      "abandonment",
    ]);
    const arrivalB = events.find(
      (e) => e.type === "arrival" && e.customerId === "b",
    );
    expect(arrivalB).toMatchObject({ decision: "leave", lineLength: 1 });
    expect(events.find((e) => e.type === "service_start")).toMatchObject({
      waitMin: 2,
      stationIndex: 0,
    });
    expect(events.find((e) => e.type === "abandonment")).toMatchObject({
      waitMin: 5,
    });
  });
});
