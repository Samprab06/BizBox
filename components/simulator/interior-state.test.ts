import { describe, expect, it } from "vitest";
import { simulateDay } from "@/lib/sim/engine";
import { replayAt } from "../replay/replay-state";
import { makeDemo, makeDemoInputs } from "./fixture";
import { interiorFrame, stationPosition } from "./interior-state";

describe("paired cafe workload", () => {
  it("keeps the exact same seeded customers and service requirements for both staffed plans", () => {
    const inputs = makeDemoInputs();
    expect(inputs.schedule.customers).toHaveLength(110);
    expect(inputs.schedule.seed).toBe(45);
    expect(inputs.configs.map((config) => config.stations.planned)).toEqual([
      1, 2,
    ]);
    expect(inputs.configs.map((config) => config.staff.headcount)).toEqual([
      1, 2,
    ]);
    expect(makeDemoInputs()).toEqual(inputs);
    const paired = makeDemo();
    paired.forEach(({ run }, index) =>
      expect(run).toEqual(simulateDay(inputs.schedule, inputs.configs[index])),
    );
    expect(paired.map(({ staffing }) => staffing?.headcount)).toEqual([1, 2]);
    const arrivals = paired.map(({ run }) =>
      run.events
        .filter((event) => event.type === "arrival")
        .map((event) => [event.customerId, event.timeMin]),
    );
    expect(arrivals[0]).toEqual(arrivals[1]);
    // Retain the actual engine outcomes instead of scripting the better option.
    expect(
      paired.map(({ run }) => [run.metrics.served, run.metrics.abandoned]),
    ).toEqual([
      [55, 52],
      [80, 28],
    ]);
    expect(
      paired[1].monthly.costs.laborUsd - paired[0].monthly.costs.laborUsd,
    ).toBe(1584);
  });
});

describe("interior replay", () => {
  const scenarios = makeDemo();
  it("uses exactly the waiting/service cohorts and station assignments at every event", () => {
    for (const scenario of scenarios) {
      const { run, staffing } = scenario;
      for (const event of run.events) {
        const frame = interiorFrame(run, event.timeMin, staffing?.headcount);
        const actual = replayAt(run.events, event.timeMin);
        expect(
          frame.customers
            .filter((dot) => dot.state === "waiting")
            .map((dot) => dot.id),
        ).toEqual(actual.waiting);
        expect(
          frame.customers
            .filter((dot) => dot.state === "serving")
            .map((dot) => dot.id),
        ).toEqual(actual.serving.map(([id]) => id));
        expect(frame.served).toBe(actual.served);
        expect(frame.left).toBe(actual.left);
        expect(new Set(frame.customers.map((dot) => dot.id)).size).toBe(
          frame.customers.length,
        );
        for (const dot of frame.customers.filter(
          (dot) => dot.state === "waiting",
        )) {
          expect(Math.abs(dot.x)).toBeLessThan(3.6);
          expect(dot.z).toBeGreaterThan(-0.1);
          expect(dot.z).toBeLessThan(2.4);
        }
      }
    }
  });
  it("places only known employees behind their corresponding counters", () => {
    for (const { run, staffing } of scenarios) {
      const frame = interiorFrame(run, 510, staffing?.headcount);
      expect(frame.employees).toHaveLength(staffing!.headcount);
      frame.employees.forEach((dot, index) => {
        expect(dot.id).toBe(`employee-${index + 1}`);
        expect(dot.x).toBe(stationPosition(index, run.metrics.stations));
        expect(dot.z).toBeLessThan(-1.5);
      });
    }
    expect(interiorFrame(scenarios[0].run, 510).employees).toEqual([]);
    expect(interiorFrame(scenarios[0].run, 479, 1).employees).toEqual([]);
    expect(interiorFrame(scenarios[0].run, 720, 1).employees).toEqual([]);
  });
  it("derives approach and exit dots from events without counting them as queued or in service", () => {
    const { run } = scenarios[0];
    const arrival = run.events.find((event) => event.type === "arrival")!;
    const before = interiorFrame(run, arrival.timeMin - 0.5, 1);
    expect(
      before.customers.find((dot) => dot.id === arrival.customerId)?.state,
    ).toBe("approaching");
    const completion = run.events.find((event) => event.type === "completion")!;
    const after = interiorFrame(run, completion.timeMin + 0.1, 1);
    expect(
      after.customers.find((dot) => dot.id === completion.customerId)?.state,
    ).toBe("leaving");
    expect(after.served).toBe(
      replayAt(run.events, completion.timeMin + 0.1).served,
    );
    expect(
      interiorFrame(run, completion.timeMin + 2.01, 1).customers.some(
        (dot) => dot.id === completion.customerId,
      ),
    ).toBe(false);
  });
  it("computes mean wait only from service starts already reached", () => {
    const { run } = scenarios[0];
    const minute = 510;
    const starts = run.events.filter(
      (event) => event.type === "service_start" && event.timeMin <= minute,
    );
    const expected =
      starts.reduce(
        (sum, event) =>
          sum + (event.type === "service_start" ? event.waitMin : 0),
        0,
      ) / starts.length;
    expect(interiorFrame(run, minute, 1).meanWaitMin).toBeCloseTo(expected);
    expect(interiorFrame(run, run.metrics.openMin, 1).meanWaitMin).toBeNull();
  });
  it("keeps an empty zero-station run usable without invented employees or NaN positions", () => {
    const run = {
      ...scenarios[0].run,
      events: [],
      metrics: { ...scenarios[0].run.metrics, stations: 0 },
    };
    const frame = interiorFrame(run, 510, 2);
    expect(frame.customers).toEqual([]);
    expect(frame.employees).toEqual([]);
    expect(frame.waiting).toEqual([]);
    expect(frame.serving).toEqual([]);
    expect(frame.served).toBe(0);
    expect(frame.left).toBe(0);
    expect(frame.meanWaitMin).toBeNull();
    expect(Number.isFinite(stationPosition(0, 0))).toBe(true);
  });
  it("seeks backwards and resets without retained dots or cumulative counters", () => {
    const { run } = scenarios[0];
    const first = interiorFrame(run, 510, 1);
    interiorFrame(run, 700, 1);
    expect(interiorFrame(run, 510, 1)).toEqual(first);
    const reset = interiorFrame(run, run.metrics.openMin, 1);
    expect(reset.waiting).toEqual([]);
    expect(reset.serving).toEqual([]);
    expect(reset.served).toBe(0);
    expect(reset.left).toBe(0);
  });
});
