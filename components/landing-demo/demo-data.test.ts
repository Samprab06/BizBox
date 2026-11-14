import { describe, expect, it } from "vitest";
import { makeDemo, demoPlan } from "@/components/simulator/fixture";
import { DEMO, createLandingDemo } from "./demo-data";

describe("prepared landing experiment", () => {
  it("reuses actual existing same-seed simulation outcomes for both setups", () => {
    const existing = makeDemo();
    for (const [index, setup] of [
      DEMO.experiment.current,
      DEMO.experiment.proposed,
    ].entries()) {
      const result = existing[index];
      expect(setup.served).toBe(result.run.metrics.served);
      expect(setup.walkaways).toBe(result.run.metrics.abandoned);
      expect(setup.p90WaitMin).toBe(result.run.metrics.p90WaitMin);
      expect(setup.revenueUsd).toBe(result.run.metrics.revenueUsd);
      expect(setup.laborUsd).toBe(result.monthly.costs.laborUsd / 22);
      expect(setup.contributionUsd).toBe(result.monthly.contributionUsd / 22);
    }
  });
  it("holds demand constant and explicitly changes staffing with station count", () => {
    const [current, proposed] = makeDemo();
    const arrivals = (run: typeof current.run) =>
      run.events
        .filter((event) => event.type === "arrival")
        .map(({ customerId, timeMin, personaId }) => ({
          customerId,
          timeMin,
          personaId,
        }));
    expect(arrivals(current.run)).toEqual(arrivals(proposed.run));
    expect(DEMO.experiment.arrivals).toBe(110);
    expect(DEMO.experiment.seed).toBe(45);
    expect(DEMO.experiment.current.stations).toBe(1);
    expect(DEMO.experiment.proposed.stations).toBe(2);
    expect(DEMO.experiment.proposed.staff - DEMO.experiment.current.staff).toBe(
      1,
    );
    expect(
      DEMO.experiment.proposed.laborUsd - DEMO.experiment.current.laborUsd,
    ).toBe(72);
    expect(DEMO.experiment.additionalBuildoutUsd).toBe(
      demoPlan.alternativeBuildout - demoPlan.baselineBuildout,
    );
  });
  it("keeps fixture property and economics consistent, deterministic and explicitly illustrative", () => {
    expect(createLandingDemo()).toEqual(DEMO);
    expect(DEMO.property.rent).toBe(
      (demoPlan.area * demoPlan.rentPerSquareFoot) / 12,
    );
    expect(DEMO.property.size).toBe(demoPlan.area);
    expect(DEMO.property.note).toMatch(/example/i);
    expect(DEMO.source).toMatch(/not a forecast/i);
    expect(DEMO.experiment.period).toBe("8 AM–noon");
    expect(DEMO.experiment.definitions.p90WaitMin).toMatch(/served/i);
    expect(DEMO.experiment.definitions.contributionUsd).toMatch(/22/);
  });
});
