import { describe, expect, it } from "vitest";
import { makeDemo } from "@/components/simulator/fixture";
import { replayAt } from "@/components/replay/replay-state";
import { hourlySeries } from "@/lib/sim/hourly";
import { statsAt } from "./stats";

describe("city playback statistics", () => {
  const runs = makeDemo().map(({ run }, i) => ({
    ...run,
    siteId: `site-${i}`,
  }));

  it("matches replay state at arbitrary minutes without including future purchases", () => {
    const run = runs[0];
    for (const minute of [480, 480.5, 521.25, 599.99, 600, 719.9, 720]) {
      const frame = replayAt(run.events, minute);
      const stats = statsAt([run], minute);
      const completions = run.events.filter(
        (e) => e.type === "completion" && e.timeMin <= minute,
      );
      expect(stats.served).toBe(frame.served);
      expect(stats.walkAways).toBe(frame.left);
      expect(stats.lineLength).toBe(frame.waiting.length);
      expect(stats.revenueUsd).toBeCloseTo(
        completions.reduce(
          (sum, e) => sum + (e.type === "completion" ? e.revenueUsd : 0),
          0,
        ),
        10,
      );
      expect(stats.purchases.at(-1)?.served).toBe(frame.served);
      expect(stats.purchases.every((point) => point.minute <= minute)).toBe(
        true,
      );
    }
  });

  it("at close matches daily totals and every hourly bucket including closing events", () => {
    for (const run of runs) {
      const stats = statsAt([run], run.metrics.closeMin);
      const hours = hourlySeries(run.events, run.metrics);
      expect(stats.served).toBe(run.metrics.served);
      expect(stats.walkAways).toBe(run.metrics.abandoned);
      expect(stats.lineLength).toBe(run.metrics.waitingAtClose);
      expect(stats.revenueUsd).toBeCloseTo(run.metrics.revenueUsd, 10);
      expect(stats.served).toBe(hours.reduce((sum, h) => sum + h.served, 0));
      expect(stats.revenueUsd).toBeCloseTo(
        hours.reduce((sum, h) => sum + h.revenueUsd, 0),
        10,
      );
    }
  });

  it("reports actual elapsed queue waits, not future service wait or a daily average", () => {
    const run = runs[0];
    const minute = run.events.find((e) => e.type === "queue_entry")!.timeMin;
    const events = [
      {
        type: "arrival" as const,
        timeMin: minute,
        customerId: "waiting",
        personaId: "p",
        lineLength: 0,
        stayProbability: 1,
        decision: "join" as const,
      },
      {
        type: "queue_entry" as const,
        timeMin: minute,
        customerId: "waiting",
        patienceMin: 100,
      },
      {
        type: "service_start" as const,
        timeMin: minute + 10,
        customerId: "waiting",
        stationIndex: 0,
        waitMin: 10,
      },
    ];
    expect(statsAt([{ ...run, events }], minute + 4.5).longestWaitMin).toBe(
      4.5,
    );
    expect(statsAt([{ ...run, events }], minute + 10).longestWaitMin).toBe(0);
  });

  it("area totals sum each site once and seeking backwards reproduces the same frame", () => {
    const minute = 600.5;
    const frame = statsAt(runs, minute);
    const single = runs.map((run) => statsAt([run], minute));
    expect(frame.served).toBe(single[0].served + single[1].served);
    expect(frame.walkAways).toBe(single[0].walkAways + single[1].walkAways);
    expect(frame.lineLength).toBe(single[0].lineLength + single[1].lineLength);
    statsAt(runs, 720);
    expect(statsAt(runs, minute)).toEqual(frame);
  });

  it("clamps seeks to opening hours and rejects incompatible clocks", () => {
    expect(statsAt(runs, -100).minute).toBe(480);
    expect(statsAt(runs, 2000).minute).toBe(720);
    expect(() => statsAt([], 500)).toThrow(RangeError);
    expect(() => statsAt(runs, NaN)).toThrow(RangeError);
    expect(() => statsAt([runs[0], runs[0]], 600)).toThrow(RangeError);
    expect(() =>
      statsAt(
        [
          runs[0],
          { ...runs[1], metrics: { ...runs[1].metrics, closeMin: 800 } },
        ],
        600,
      ),
    ).toThrow(RangeError);
  });
});
