import { describe, expect, it } from "vitest";
import { makeDemo, makeDemoInputs } from "@/components/simulator/fixture";
import type { SimEvent } from "./contracts";
import {
  ageBand,
  arrivedCustomers,
  filterCustomers,
  incomeBand,
  inspectCustomer,
  type InspectPersona,
} from "./inspect";
import { buildTrips, type AgentTrip } from "./trips";

const { schedule } = makeDemoInputs();
const run = makeDemo()[0].run;
const { openMin, closeMin } = run.metrics;
const persona: InspectPersona = {
  id: "morning-visitor",
  label: "Morning commuter",
  kind: "passby",
  incomeUsd: 62_000,
  age: 31,
  hasKids: false,
  commuteMode: "walk",
  answers: {
    source: "Synthetic choice shares",
    where: [{ label: "This site", share: 0.4 }],
    visitsPerMonth: 6,
  },
};
const trips: AgentTrip[] = buildTrips(
  schedule,
  [{ id: "morning-visitor", kind: "passby", commuteMode: "walk" }],
  run,
  {
    id: run.siteId,
    door: { value: [0, 0], provenance: "assumed", source: "test door" },
    streetBearingDeg: { value: 0, provenance: "assumed", source: "test" },
    frontage: {
      value: [
        [0, -0.001],
        [0, 0.001],
      ],
      provenance: "assumed",
      source: "test frontage",
    },
  },
  1,
);

const first = (type: SimEvent["type"], filter?: (e: SimEvent) => boolean) =>
  run.events.find((e) => e.type === type && (!filter || filter(e)))!;
const servedId = first("completion").customerId;
const balkedId = first(
  "arrival",
  (e) => e.type === "arrival" && e.decision === "leave",
).customerId;
const inspect = (customerId: string, minute: number, events = run.events) =>
  inspectCustomer({
    events,
    minute,
    customerId,
    schedule,
    personas: [persona],
    trips,
    closeMin,
  });

describe("inspectCustomer", () => {
  it("never reveals an outcome after the inspected minute (seek back)", () => {
    const ids = [...new Set(run.events.map((e) => e.customerId))];
    for (let minute = openMin - 5; minute <= closeMin + 5; minute += 0.5) {
      const past = run.events.filter((e) => e.timeMin <= minute);
      for (const id of ids) {
        // A card computed from the full day equals one computed with the future removed.
        expect(inspect(id, minute)).toEqual(inspect(id, minute, past));
      }
    }
  });

  it("shows a served customer's outcome only once completion has happened", () => {
    const start = run.events.find(
      (e) => e.type === "service_start" && e.customerId === servedId,
    )!;
    const done = run.events.find(
      (e) => e.type === "completion" && e.customerId === servedId,
    )!;
    const during = inspect(servedId, (start.timeMin + done.timeMin) / 2);
    expect(during.outcome).toBeNull();
    expect(during.activity).toBe("in_service");
    expect(during.service?.durationMin).toBeNull();
    expect(during.why).not.toMatch(/served at/);
    const after = inspect(servedId, done.timeMin);
    expect(after.outcome).toBe("served");
    expect(after.service?.durationMin).toBeCloseTo(done.timeMin - start.timeMin);
    // Seeking back to the arrival restores the pre-outcome card.
    const arrival = first("arrival", (e) => e.customerId === servedId);
    expect(inspect(servedId, arrival.timeMin).outcome).toBeNull();
  });

  it("hides everything before arrival, including persona and answers", () => {
    const arrival = first("arrival", (e) => e.customerId === servedId);
    const card = inspectCustomer({
      events: run.events,
      minute: arrival.timeMin - 30,
      customerId: servedId,
      schedule,
      personas: [persona],
      closeMin,
    });
    expect(card.activity).toBe("not_arrived");
    expect(card.persona.label).toBeNull();
    expect(card.answers).toBeNull();
    expect(card.arrival).toBeNull();
    expect(card.history).toEqual([]);
  });

  it("traces every number to the arrival event, schedule, persona or trip", () => {
    const arrival = first("arrival", (e) => e.customerId === balkedId);
    if (arrival.type !== "arrival") throw new Error("expected arrival");
    const card = inspect(balkedId, arrival.timeMin);
    expect(card.arrival).toMatchObject({
      minute: arrival.timeMin,
      lineLength: arrival.lineLength,
      stayProbability: arrival.stayProbability,
      decision: "leave",
      stayDraw: schedule.customers.find((c) => c.id === balkedId)!.stayDraw,
    });
    expect(card.outcome).toBe("balked");
    expect(card.wait).toBeNull();
    expect(card.persona).toMatchObject({
      label: "Morning commuter",
      kind: "passby",
      incomeBand: "$50k–$75k",
      ageBand: "25–34",
      hasKids: false,
    });
    expect(card.answers).toEqual(persona.answers);
    const trip = trips.find((t) => t.customerId === balkedId)!;
    const door = trip.path[trip.doorArrivalIndex];
    expect(card.travel.mode).toBe("walk");
    expect(card.travel.geometry).toBe("assumed");
    expect(card.travel.originDistanceMeters).toBeCloseTo(
      Math.abs(trip.origin[1] - door[1]) * 111_320,
      0,
    );
    expect(card.why).toBe(
      `Saw ${arrival.lineLength} in line, stay probability ${arrival.stayProbability.toFixed(2)}, walked away.`,
    );
  });

  it("reports the wait so far while in line and the final wait afterwards", () => {
    const entry = run.events.find(
      (e) =>
        e.type === "queue_entry" &&
        run.events.some(
          (s) =>
            s.type === "service_start" &&
            s.customerId === e.customerId &&
            s.waitMin > 1,
        ),
    )!;
    const start = run.events.find(
      (e) => e.type === "service_start" && e.customerId === entry.customerId,
    )!;
    if (start.type !== "service_start") throw new Error("expected start");
    const waiting = inspect(entry.customerId, entry.timeMin + 1);
    expect(waiting.activity).toBe("waiting");
    expect(waiting.wait).toEqual({ minutes: 1, final: false });
    expect(waiting.why).toMatch(/waiting 1\.0 min so far/);
    expect(inspect(entry.customerId, start.timeMin).wait).toEqual({
      minutes: start.waitMin,
      final: true,
    });
  });

  it("labels unavailable metadata instead of inventing it", () => {
    const card = inspectCustomer({
      events: run.events,
      minute: closeMin,
      customerId: servedId,
    });
    expect(card.persona).toMatchObject({
      label: null,
      kind: null,
      incomeBand: null,
      ageBand: null,
      hasKids: null,
    });
    expect(card.travel).toEqual({
      mode: null,
      originDistanceMeters: null,
      geometry: null,
    });
    expect(card.answers).toBeNull();
    expect(card.arrival?.stayDraw).toBeNull();
  });

  it("does not present a stored run's reconstructed decision as a probability", () => {
    const card = inspectCustomer({
      events: run.events,
      minute: closeMin,
      customerId: balkedId,
      source: "stored",
    });
    expect(card.arrival?.stayProbability).toBeNull();
    expect(card.why).toMatch(/stay probability not stored/);
  });

  it("marks customers still in line or service at closing", () => {
    const open = [...new Set(run.events.map((e) => e.customerId))].find(
      (id) =>
        run.events.some(
          (e) => e.customerId === id && e.type === "queue_entry",
        ) &&
        !run.events.some(
          (e) =>
            e.customerId === id &&
            (e.type === "completion" || e.type === "abandonment"),
        ),
    );
    if (!open) return;
    const card = inspect(open, closeMin + 1);
    expect(card.atClose).toBe(true);
    expect(card.outcome).toBeNull();
    expect(card.why).toMatch(/at closing/);
  });

  it("rejects a non-finite minute", () => {
    expect(() => inspect(servedId, Number.NaN)).toThrow(RangeError);
  });
});

describe("customer list", () => {
  it("lists only customers who have arrived by the minute", () => {
    const minute = openMin + 30;
    const ids = arrivedCustomers(run.events, minute);
    const expected = run.events
      .filter((e) => e.type === "arrival" && e.timeMin <= minute)
      .map((e) => e.customerId);
    expect(ids).toEqual(expected);
    expect(arrivedCustomers(run.events, openMin - 1)).toEqual([]);
  });

  it("filters by ID or persona label, ignoring case", () => {
    const ids = ["customer-1", "customer-12", "customer-2"];
    expect(filterCustomers(ids, " CUSTOMER-1")).toEqual([
      "customer-1",
      "customer-12",
    ]);
    expect(
      filterCustomers(ids, "commuter", (id) =>
        id === "customer-2" ? "Morning commuter" : undefined,
      ),
    ).toEqual(["customer-2"]);
    expect(filterCustomers(ids, "")).toEqual(ids);
  });
});

describe("bands", () => {
  it("bands persona income and age and leaves missing values unavailable", () => {
    expect(incomeBand(24_999)).toBe("Under $25k");
    expect(incomeBand(150_000)).toBe("$150k and over");
    expect(incomeBand(undefined)).toBeNull();
    expect(ageBand(17)).toBe("Under 18");
    expect(ageBand(65)).toBe("65 and over");
    expect(ageBand(Number.NaN)).toBeNull();
  });
});
