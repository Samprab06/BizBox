import { describe, expect, it } from "vitest";
import { routePointAt } from "./experiment-playback";

describe("saved spatial walking playback", () => {
  it("uses route distance and saved timestamps, supports backwards seeking", () => {
    const customer = {
      walkStartMin: 10,
      queueArrivalMin: 14,
      route: [
        { x: 0, z: 0 },
        { x: 0, z: 3 },
        { x: 1, z: 3 },
      ],
    };
    expect(routePointAt(customer, 12)).toEqual({ x: 0, z: 2 });
    expect(routePointAt(customer, 20)).toEqual({ x: 1, z: 3 });
    expect(routePointAt(customer, 0)).toEqual({ x: 0, z: 0 });
  });
});
