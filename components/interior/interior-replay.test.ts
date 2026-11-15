import { describe, expect, it } from "vitest";
import { makeDemo } from "../simulator/fixture";
import { replayAt } from "../replay/replay-state";
import { statsAt } from "../city/stats";
import { layoutFromRoomBounds, modeledLayout } from "@/lib/sim/interior-layout";
import { interiorCountsAt, interiorFrameAt } from "./interior-replay";

const demo = makeDemo();
const room = { minX: 0, maxX: 10, minZ: 0, maxZ: 9.290304, floorY: 0 };

describe("interior replay", () => {
  it.each(demo.map((plan, index) => [index, plan] as const))(
    "equals replayAt and the city view at every minute (plan %i)",
    (_, { run, staffing }) => {
      const layouts = [
        modeledLayout(run.metrics.stations),
        layoutFromRoomBounds(room, run.metrics.stations),
      ];
      const { openMin, closeMin } = run.metrics;
      for (let minute = openMin - 3; minute <= closeMin + 3; minute += 0.5) {
        const truth = replayAt(run.events, minute);
        const city = statsAt([run], minute);
        const counts = interiorCountsAt(run.events, minute);
        expect(counts).toEqual({
          arrivals: truth.arrivals.size,
          inLine: truth.waiting.length,
          inService: truth.serving.length,
          served: truth.served,
          left: truth.left,
        });
        if (minute >= openMin && minute <= closeMin) {
          expect(counts.inLine).toBe(city.lineLength);
          expect(counts.served).toBe(city.served);
          expect(counts.left).toBe(city.walkAways);
        }
        for (const layout of layouts) {
          const frame = interiorFrameAt(
            run,
            minute,
            layout,
            staffing?.headcount,
          );
          expect(frame.counts).toEqual(counts);
          const inLine = frame.agents.filter((a) => a.state === "in_line");
          const atStation = frame.agents.filter(
            (a) => a.state === "at_station",
          );
          expect(inLine.map((a) => a.id)).toEqual(truth.waiting);
          expect(atStation.map((a) => [a.id, a.station])).toEqual(
            truth.serving,
          );
          const ids = frame.agents.map((a) => a.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    },
  );

  it("is a pure function of the minute, so seeking holds no state", () => {
    const { run } = demo[1];
    const layout = modeledLayout(run.metrics.stations);
    const direct = interiorFrameAt(run, 600, layout, 2);
    interiorFrameAt(run, 700, layout, 2);
    interiorFrameAt(run, 480, layout, 2);
    expect(interiorFrameAt(run, 600, layout, 2)).toEqual(direct);
  });

  it("places line, station and staff agents on the layout", () => {
    const { run } = demo[0];
    const layout = layoutFromRoomBounds(room, run.metrics.stations);
    let checked = false;
    for (
      let minute = run.metrics.openMin;
      minute < run.metrics.closeMin;
      minute++
    ) {
      const frame = interiorFrameAt(run, minute, layout, 1);
      const line = frame.agents.filter((a) => a.state === "in_line");
      if (line.length < 2) continue;
      expect(line[0]).toMatchObject(layout.queue[0]);
      expect(line[1].z).toBeCloseTo(
        layout.queue[0].z - layout.queueSpacingM,
        6,
      );
      for (const agent of frame.agents.filter((a) => a.state === "at_station"))
        expect(agent).toMatchObject(layout.stations[agent.station!]);
      expect(frame.agents.filter((a) => a.role === "employee")).toEqual([
        {
          id: "employee-1",
          role: "employee",
          state: "staffing",
          station: 0,
          ...layout.staff[0],
        },
      ]);
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  });

  it("shows entering and leaving customers only around their events", () => {
    const { run } = demo[0];
    const layout = modeledLayout(run.metrics.stations);
    const arrival = run.events.find((e) => e.type === "arrival")!;
    const before = interiorFrameAt(run, arrival.timeMin - 1, layout);
    expect(before.agents.find((a) => a.id === arrival.customerId)?.state).toBe(
      "entering",
    );
    const long = interiorFrameAt(run, arrival.timeMin - 5, layout);
    expect(long.agents.some((a) => a.id === arrival.customerId)).toBe(false);
    const completion = run.events.find((e) => e.type === "completion")!;
    const after = interiorFrameAt(run, completion.timeMin + 1, layout);
    expect(
      after.agents.find((a) => a.id === completion.customerId)?.state,
    ).toBe("leaving");
  });

  it("rejects a layout with fewer stations than the run", () => {
    expect(() => interiorFrameAt(demo[1].run, 500, modeledLayout(1))).toThrow();
  });
});
