import { describe, expect, it, vi } from "vitest";
import type { DayResult, SimEvent } from "@/lib/sim/contracts";
import { getPreviewProject } from "@/lib/workspace-preview";
import { hourLabel, meanServiceMin, siteHours } from "./hourly-overlay";

// Keep the example on its Huff fixture so the test doesn't depend on a recorded Jev panel.
vi.mock("@/lib/panel/recorded-example-loader", () => ({
  loadRecordedExample: () => undefined,
}));

describe("meanServiceMin", () => {
  it("averages service start to completion for finished customers only", () => {
    const events = [
      { type: "service_start", timeMin: 60, customerId: "a" },
      { type: "service_start", timeMin: 62, customerId: "b" },
      { type: "completion", timeMin: 64, customerId: "a" },
      { type: "completion", timeMin: 68, customerId: "b" },
      { type: "service_start", timeMin: 70, customerId: "c" },
    ] as unknown as SimEvent[];
    expect(meanServiceMin(events)).toBe(5);
    expect(meanServiceMin([])).toBeNull();
  });
});

describe("hourLabel", () => {
  it("formats 12-hour labels", () => {
    expect([0, 7, 12, 15].map(hourLabel)).toEqual([
      "12 AM",
      "7 AM",
      "12 PM",
      "3 PM",
    ]);
  });
});

describe("comparison hourly overlay", async () => {
  const { exampleComparison } = await import("./example-comparison");
  const rows = exampleComparison(getPreviewProject("houston-coffee")!.sites);

  it("uses the same comparison and run IDs as the table", () => {
    for (const row of rows) {
      const data = siteHours(row.site.id, row.runId, row.run);
      expect(data.runId).toBe(row.runId);
      expect(data.siteId).toBe(row.site.id);
      expect(data.runId.startsWith("houston-coffee-example-v1-1-")).toBe(true);
    }
  });

  it("covers only open hours and keeps every arrival", () => {
    for (const row of rows) {
      const { hours } = siteHours(row.site.id, row.runId, row.run);
      const { openMin, closeMin, arrivals } = row.run.metrics;
      expect(hours[0].hour).toBe(Math.floor(openMin / 60));
      expect(hours.at(-1)!.hour).toBe(Math.ceil(closeMin / 60) - 1);
      expect(hours.reduce((sum, h) => sum + h.arrivals, 0)).toBe(arrivals);
    }
  });

  it("derives capacity from stations, open minutes and mean service time", () => {
    const row = rows[0];
    const service = meanServiceMin(row.run.events)!;
    const { hours } = siteHours(row.site.id, row.runId, row.run);
    for (const h of hours)
      expect(h.capacity).toBeCloseTo((row.run.metrics.stations * 60) / service);
  });

  it("marks the busiest open hour as the peak", () => {
    for (const row of rows) {
      const data = siteHours(row.site.id, row.runId, row.run);
      const most = Math.max(...data.hours.map((h) => h.arrivals));
      expect(data.hours.find((h) => h.hour === data.peakHour)!.arrivals).toBe(
        most,
      );
    }
  });

  it("returns no peak and no capacity for a day with no customers", () => {
    const empty = {
      ...rows[0].run,
      events: [],
      metrics: { ...rows[0].run.metrics, arrivals: 0 },
    } as DayResult;
    const data = siteHours("empty", "run-empty", empty);
    expect(data.peakHour).toBeNull();
    expect(data.hours.every((h) => h.capacity === null)).toBe(true);
    expect(data.hours.every((h) => h.p90WaitMin === null)).toBe(true);
  });
});
