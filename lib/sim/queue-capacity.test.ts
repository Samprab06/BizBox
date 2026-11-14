import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SiteConfigSchema,
  type ArrivalSchedule,
  type SiteConfigInput,
} from "./contracts";
import { EngineInputError, simulateDay } from "./engine";

const config: SiteConfigInput = {
  hours: {
    weekday: { openMin: 480, closeMin: 540 },
    weekend: { openMin: 480, closeMin: 540 },
  },
  stations: { planned: 1, usableSf: 100, sfPerStation: 100 },
  service: { meanServiceMin: 10 },
  prices: { avgTicketUsd: 10 },
  staff: { headcount: 1, wageUsdPerHour: 20 },
  costs: { cogsPctOfRevenue: 0.3 },
  lease: {
    sf: 100,
    askingRentUsdPerSfYear: 24,
    tripleNet: false,
    buildoutUsd: 0,
    leaseTermMonths: 12,
  },
  calendar: { weekdayDaysPerMonth: 20, weekendDaysPerMonth: 8 },
};
const schedule: ArrivalSchedule = {
  siteId: "capacity-fixture",
  seed: 86,
  dayType: "weekday",
  openMin: 480,
  closeMin: 540,
  demandSource: "huff",
  params: {},
  stayCurves: [{ personaId: "p", points: [{ lineLength: 0, p: 1 }] }],
  customers: [480, 481, 482, 490, 539, 540].map((arrivalMin, i) => ({
    id: `c${i}`,
    personaId: "p",
    arrivalMin,
    stayDraw: 0.1,
    serviceMin: 10,
  })),
};

describe("physical waiting capacity", () => {
  it("preserves historical a0ce767 JSON bytes when capacity is absent", () => {
    const json = JSON.stringify(simulateDay(schedule, config));
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "cf515f65a0c19792780c3db845bbbe7627b8576ebd49e4b7d2a431426cdb74cb",
    );
  });
  it("zero permits immediate service and balks arrivals that would wait", () => {
    const result = simulateDay(schedule, { ...config, queueCapacity: 0 });
    expect(result.metrics).toMatchObject({
      arrivals: 5,
      joined: 3,
      balked: 2,
      served: 2,
      inServiceAtClose: 1,
      waitingAtClose: 0,
    });
    expect(
      result.events.find((e) => e.type === "arrival" && e.customerId === "c3"),
    ).toMatchObject({ decision: "join" });
    expect(
      result.events.find((e) => e.type === "arrival" && e.customerId === "c1"),
    ).toMatchObject({ decision: "leave", stayProbability: 1 });
  });
  it("caps waiting people, excluding the customer in service", () => {
    const result = simulateDay(schedule, { ...config, queueCapacity: 1 });
    expect(result.metrics).toMatchObject({
      joined: 4,
      balked: 1,
      waitingAtClose: 0,
    });
    expect(
      result.events.find((e) => e.type === "arrival" && e.customerId === "c2"),
    ).toMatchObject({ decision: "leave", lineLength: 1 });
  });
  it.each([-1, 0.5, Infinity, NaN])(
    "rejects invalid queue capacity %s with field errors",
    (queueCapacity) => {
      try {
        simulateDay(schedule, { ...config, queueCapacity });
      } catch (error) {
        expect(error).toBeInstanceOf(EngineInputError);
        expect((error as EngineInputError).fieldErrors).toHaveProperty([
          "config.queueCapacity",
        ]);
        return;
      }
      throw new Error("expected capacity validation failure");
    },
  );
  it("keeps capacity optional instead of defaulting old configurations", () => {
    expect(SiteConfigSchema.parse(config)).not.toHaveProperty("queueCapacity");
  });
});
