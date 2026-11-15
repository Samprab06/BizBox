import { describe, expect, it } from "vitest";
import { makeDemo } from "./fixture";
import {
  projectCustomerMotion,
  projectEmployeeMotion,
  customerMotionWindow,
  type CustomerMotionGeometry,
} from "./customer-motion";
const geometry: CustomerMotionGeometry = {
  entrance: { x: 0, z: 3 },
  outsideApproach: { x: -8, z: 4 },
  outsideExit: { x: 8, z: 4 },
  approachVia: [{ x: 0, z: 4 }],
  exitVia: [
    { x: 3, z: 2 },
    { x: 0, z: 3 },
  ],
  queueSlot: (index) => ({ x: -2 + index * 0.6, z: 1 }),
  stationPoint: (index) => ({ x: index * 2, z: -1 }),
  staffPoint: (index) => ({ x: index * 2, z: -2 }),
};
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
describe("continuous saved customer trajectories", () => {
  it("preserves every visible identity and position across all engine event boundaries", () => {
    for (const { run } of makeDemo())
      for (const event of run.events) {
        const before = new Map(
          projectCustomerMotion(run, event.timeMin - 1e-6, geometry).map(
            (dot) => [dot.id, dot],
          ),
        );
        const after = new Map(
          projectCustomerMotion(run, event.timeMin + 1e-6, geometry).map(
            (dot) => [dot.id, dot],
          ),
        );
        for (const [id, point] of before) {
          const next = after.get(id);
          expect(next, `${id} disappeared at ${event.type}`).toBeDefined();
          expect(distance(point, next!)).toBeLessThan(0.001);
        }
      }
  });
  it("keeps all110 customers until their actual departure reaches the exit", () => {
    const { run } = makeDemo()[0];
    const arrivals = run.events.filter((event) => event.type === "arrival");
    expect(arrivals).toHaveLength(110);
    for (const arrival of arrivals) {
      const departure = run.events.find(
        (event) =>
          event.customerId === arrival.customerId &&
          (event.type === "completion" ||
            event.type === "abandonment" ||
            (event.type === "arrival" && event.decision === "leave")),
      );
      const end =
        customerMotionWindow(run, arrival.customerId, geometry)!.endMin ??
        run.metrics.closeMin + 2;
      for (let t = arrival.timeMin - 1.99; t < end - 1e-5; t += 0.25)
        expect(
          projectCustomerMotion(run, t, geometry).some(
            (dot) => dot.id === arrival.customerId,
          ),
        ).toBe(true);
      if (departure) {
        const last = projectCustomerMotion(run, end - 1e-6, geometry).find(
          (dot) => dot.id === arrival.customerId,
        )!;
        expect(distance(last, geometry.outsideExit)).toBeLessThan(0.001);
        expect(
          projectCustomerMotion(run, end, geometry).some(
            (dot) => dot.id === arrival.customerId,
          ),
        ).toBe(false);
      }
    }
  });
  it("is independent of seek order and starts an immediate balk at the entry location", () => {
    const { run } = makeDemo()[0];
    const first = projectCustomerMotion(run, 510, geometry);
    projectCustomerMotion(run, 700, geometry);
    expect(projectCustomerMotion(run, 510, geometry)).toEqual(first);
    const balk = run.events.find(
      (event) => event.type === "arrival" && event.decision === "leave",
    )!;
    expect(
      distance(
        projectCustomerMotion(run, balk.timeMin, geometry).find(
          (dot) => dot.id === balk.customerId,
        )!,
        geometry.entrance,
      ),
    ).toBeLessThan(1e-8);
  });
  it("lets workers finish a visual exit instead of vanishing at closing", () => {
    const { run } = makeDemo()[0];
    const t = run.metrics.closeMin;
    const before = projectEmployeeMotion(run, t - 1e-6, 2, geometry),
      after = projectEmployeeMotion(run, t + 1e-6, 2, geometry);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(distance(before[0]!, after[0]!)).toBeLessThan(0.001);
    expect(projectEmployeeMotion(run, t + 100, 2, geometry)).toEqual([]);
  });
});
