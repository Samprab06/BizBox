import { expect, it } from "vitest";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";
import { scanLayout } from "./scan-layout";
const epsilon = 1e-6;
it("keeps the same visible customer at a continuous scan coordinate across every engine event", () => {
  for (const { run, staffing } of makeDemo())
    for (const event of run.events) {
      const before = scanLayout(
        interiorFrame(run, event.timeMin - epsilon, staffing?.headcount),
        run.metrics.stations,
      ).people.find((p) => p.id === event.customerId);
      const at = scanLayout(
        interiorFrame(run, event.timeMin, staffing?.headcount),
        run.metrics.stations,
      ).people.find((p) => p.id === event.customerId);
      const after = scanLayout(
        interiorFrame(run, event.timeMin + epsilon, staffing?.headcount),
        run.metrics.stations,
      ).people.find((p) => p.id === event.customerId);
      expect(before, `${event.type} before ${event.customerId}`).toBeDefined();
      expect(at).toBeDefined();
      expect(after).toBeDefined();
      expect(
        Math.hypot(before!.x - at!.x, before!.z - at!.z),
        `${event.type} jump at ${event.customerId}`,
      ).toBeLessThan(0.001);
      expect(Math.hypot(after!.x - at!.x, after!.z - at!.z)).toBeLessThan(
        0.001,
      );
    }
});
it("supports seek-back and does not change engine events or metrics", () => {
  const { run } = makeDemo()[0]!;
  const original = JSON.stringify(run),
    event = run.events.find((e) => e.type === "completion")!;
  const sample = () =>
    scanLayout(
      interiorFrame(run, event.timeMin + 0.5, 1),
      run.metrics.stations,
    );
  const expected = sample();
  scanLayout(interiorFrame(run, run.metrics.closeMin, 1), run.metrics.stations);
  expect(sample()).toEqual(expected);
  expect(JSON.stringify(run)).toBe(original);
});
it("moves all queued customers continuously when someone else enters service or leaves", () => {
  for (const { run, staffing } of makeDemo())
    for (const event of run.events) {
      const before = scanLayout(
        interiorFrame(run, event.timeMin - epsilon, staffing?.headcount),
        run.metrics.stations,
      ).people.filter((p) => p.role === "customer");
      const after = scanLayout(
        interiorFrame(run, event.timeMin + epsilon, staffing?.headcount),
        run.metrics.stations,
      ).people.filter((p) => p.role === "customer");
      const byId = new Map(after.map((p) => [p.id, p]));
      for (const person of before) {
        const next = byId.get(person.id);
        if (next)
          expect(
            Math.hypot(person.x - next.x, person.z - next.z),
            `${person.id} moved discontinuously during ${event.type} for ${event.customerId}`,
          ).toBeLessThan(0.001);
      }
    }
});
it("keeps purple staff continuous at closing and exits before removal", () => {
  const { run, staffing } = makeDemo()[1]!;
  const close = run.metrics.closeMin;
  const people = (t: number) =>
    scanLayout(
      interiorFrame(run, t, staffing?.headcount),
      run.metrics.stations,
    ).people.filter((p) => p.role === "employee");
  const before = people(close - epsilon),
    at = people(close),
    after = people(close + epsilon);
  expect(before.map((p) => p.id)).toEqual(at.map((p) => p.id));
  expect(after.map((p) => p.id)).toEqual(at.map((p) => p.id));
  for (const person of before) {
    const next = after.find((p) => p.id === person.id)!;
    expect(Math.hypot(person.x - next.x, person.z - next.z)).toBeLessThan(
      0.001,
    );
  }
  expect(people(close + 1)).toHaveLength(before.length);
  expect(people(close + 100)).toHaveLength(0);
});
it("keeps every customer visible throughout their in-room lifetime and removes them only at the outside exit", async () => {
  const { customerMotionWindow } = await import("../simulator/customer-motion");
  const { scanMotionGeometry } = await import("./scan-layout");
  for (const { run } of makeDemo()) {
    const geometry = scanMotionGeometry(run.metrics.stations);
    for (const event of run.events.filter((e) => e.type === "arrival")) {
      const window = customerMotionWindow(run, event.customerId, geometry)!;
      const dot = (minute: number) =>
        scanLayout(
          interiorFrame(run, minute, 0),
          run.metrics.stations,
        ).people.find((p) => p.id === event.customerId);
      expect(dot(window.startMin - epsilon)).toBeUndefined();
      const visibleEnd = window.endMin ?? run.metrics.closeMin;
      for (let i = 0; i <= 10; i++)
        expect(
          dot(
            window.startMin +
              epsilon +
              ((visibleEnd - window.startMin - 2 * epsilon) * i) / 10,
          ),
        ).toBeDefined();
      if (window.endMin !== null) {
        const last = dot(window.endMin - epsilon)!;
        expect(
          Math.hypot(
            last.x - geometry.outsideExit.x,
            last.z - geometry.outsideExit.z,
          ),
        ).toBeLessThan(0.001);
        expect(dot(window.endMin + epsilon)).toBeUndefined();
      }
    }
  }
});
