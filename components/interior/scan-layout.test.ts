import { expect, it } from "vitest";
import { makeDemo } from "../simulator/fixture";
import { interiorFrame } from "../simulator/interior-state";
import { scanLayout } from "./scan-layout";

it("retains every replay identity while giving standing human-scale spheres at least 2m spacing", () => {
  for (const { run, staffing } of makeDemo()) {
    for (const event of run.events) {
      const frame = interiorFrame(run, event.timeMin, staffing?.headcount);
      const layout = scanLayout(frame, run.metrics.stations);
      expect(layout.people.map((person) => person.id).sort()).toEqual(
        [...frame.customers, ...frame.employees]
          .map((person) => person.id)
          .sort(),
      );
      const standing = layout.people.filter(
        (person) =>
          person.role === "employee" ||
          person.state === "waiting" ||
          person.state === "serving",
      );
      standing.forEach((person, index) => {
        for (const other of standing.slice(index + 1))
          expect(
            Math.hypot(person.x - other.x, person.z - other.z),
          ).toBeGreaterThanOrEqual(2);
      });
      expect(
        layout.people
          .filter((person) => person.state === "waiting")
          .map((person) => [person.x, person.z]),
      ).toEqual(
        frame.waiting.map((_, index) => [
          index < 4 ? 0 : (index - 3) * 2.2,
          Math.min(index + 1, 4) * 2.2,
        ]),
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
  expect(leaving.map((person) => person.x)).toEqual([-6, -6, -6]);
  expect(leaving[0].z).toBeLessThan(leaving[1].z);
  expect(leaving[1].z).toBeLessThan(leaving[2].z);
  for (const person of [...approaching, ...leaving]) {
    expect(person.z).toBeGreaterThanOrEqual(2.2);
    expect(person.z).toBeLessThanOrEqual(10);
  }
});
