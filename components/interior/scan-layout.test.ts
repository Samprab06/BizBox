import { expect, it } from "vitest";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";
import { scanLayout, scanMotionGeometry } from "./scan-layout";

it("retains replay identities and human-scale destination spacing without teleporting to slots", () => {
  for (const { run, staffing } of makeDemo()) {
    for (const event of run.events) {
      const frame = interiorFrame(run, event.timeMin, staffing?.headcount);
      const layout = scanLayout(frame, run.metrics.stations);
      const visibleIds = layout.people.map((person) => person.id);
      expect(new Set(visibleIds).size).toBe(visibleIds.length);
      for (const id of [
        ...frame.waiting,
        ...frame.serving.map(([id]) => id),
        ...frame.employees.map((person) => person.id),
      ])
        expect(visibleIds).toContain(id);
      const engineIds = new Set(run.events.map((event) => event.customerId));
      expect(
        layout.people
          .filter((person) => person.role === "customer")
          .every((person) => engineIds.has(person.id)),
      ).toBe(true);
      const standing = layout.people.filter(
        (person) => person.role === "employee",
      );
      standing.forEach((person, index) => {
        for (const other of standing.slice(index + 1))
          expect(
            Math.hypot(person.x - other.x, person.z - other.z),
          ).toBeGreaterThanOrEqual(2);
      });
      expect(
        frame.waiting.map((_, index) =>
          scanMotionGeometry(run.metrics.stations).queueSlot(index),
        ),
      ).toEqual(
        frame.waiting.map((_, index) => ({
          x: index < 4 ? 0 : (index - 3) * 2.2,
          z: Math.min(index + 1, 4) * 2.2,
        })),
      );
      expect(layout.stations).toHaveLength(run.metrics.stations);
    }
  }
});

it("keeps approach and exit presentation on separate lanes with monotonic travel", () => {
  const { run } = makeDemo()[0];
  const arrival = run.events.find((event) => event.type === "arrival")!;
  const approaching = [1.9, 1, 0.1].map((before) =>
    scanLayout(interiorFrame(run, arrival.timeMin - before, 1), 1).people.find(
      (person) => person.id === arrival.customerId,
    )!,
  );
  expect(approaching.map((person) => person.x)).toEqual([-4, -4, -4]);
  expect(approaching[0].z).toBeGreaterThan(approaching[1].z);
  expect(approaching[1].z).toBeGreaterThan(approaching[2].z);
  const completion = run.events.find((event) => event.type === "completion")!;
  const leaving = [0.1, 1, 1.9].map((after) =>
    scanLayout(
      interiorFrame(run, completion.timeMin + after, 1),
      1,
    ).people.find((person) => person.id === completion.customerId)!,
  );
  expect(leaving[0].x).toBeGreaterThanOrEqual(leaving[1].x);
  expect(leaving[1].x).toBeGreaterThanOrEqual(leaving[2].x);
  expect(leaving[0].z).toBeLessThan(leaving[1].z);
  expect(leaving[1].z).toBeLessThan(leaving[2].z);
  for (const person of approaching) {
    expect(person.z).toBeGreaterThanOrEqual(2.2);
    expect(person.z).toBeLessThanOrEqual(10);
  }
});

it("keeps stationary service/staff/queue destination markers at human scale", () => {
  const geometry = scanMotionGeometry(2),
    points = [
      geometry.stationPoint(0),
      geometry.stationPoint(1),
      ...Array.from({ length: 10 }, (_, i) => geometry.queueSlot(i)),
    ];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      expect(
        Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z),
      ).toBeGreaterThanOrEqual(2);
});
