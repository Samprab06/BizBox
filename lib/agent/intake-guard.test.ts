import { describe, expect, it } from "vitest";
import {
  founderSaidUnknown,
  stripUnsupportedUnknowns,
  withFounderProvenance,
} from "./intake-guard";

const unknown = (reason = "Founder does not know") => ({
  value: null,
  unit: "cents",
  unknownReason: reason,
});
const known = (value: number) => ({ value, unit: "cents" });

describe("unknown guard (HAC-113)", () => {
  it("never accepts an unknown from a message that does not mention the topic", () => {
    const message =
      "I'm opening a neighborhood coffee shop called Bean There in Houston. Goal: find a walkable spot with strong morning commuter traffic.";
    for (const field of [
      "economics.monthlyRentCeilingCents",
      "economics.buildoutBudgetCents",
      "economics.startupBudgetCents",
      "economics.monthlyOperatingBudgetCents",
    ])
      expect(founderSaidUnknown(message, field)).toBe(false);
  });

  it("accepts an unknown only for the topic the founder said they do not know", () => {
    const message = "I don't know my rent budget yet. Buildout is $80k.";
    expect(
      founderSaidUnknown(message, "economics.monthlyRentCeilingCents"),
    ).toBe(true);
    expect(founderSaidUnknown(message, "economics.buildoutBudgetCents")).toBe(
      false,
    );
    expect(founderSaidUnknown(message, "economics.startupBudgetCents")).toBe(
      false,
    );
  });

  it("lets an umbrella word cover the group and a bare answer cover the pending question", () => {
    expect(
      founderSaidUnknown(
        "Not sure about any of the budget numbers",
        "economics.startupBudgetCents",
      ),
    ).toBe(true);
    expect(
      founderSaidUnknown("I don't know", "economics.startupBudgetCents"),
    ).toBe(false);
    expect(
      founderSaidUnknown("I don't know", "economics.startupBudgetCents", [
        "economics.startupBudgetCents",
      ]),
    ).toBe(true);
    // A signal in one clause does not license an unrelated topic in another.
    expect(
      founderSaidUnknown(
        "Rent is $4000 but I'm not sure about parking",
        "economics.monthlyRentCeilingCents",
      ),
    ).toBe(false);
  });

  it("strips unsupported unknowns, keeps stated values, and leaves fields undefined", () => {
    const { patch, dropped } = stripUnsupportedUnknowns(
      {
        concept: "Coffee",
        targetCustomers: null,
        economics: {
          monthlyRentCeilingCents: unknown(),
          buildoutBudgetCents: known(5_000_000),
        },
        capacity: { servers: unknown() },
      },
      "Bean There is a coffee shop. Buildout budget is $50k.",
    );
    expect(patch).toEqual({
      concept: "Coffee",
      economics: { buildoutBudgetCents: known(5_000_000) },
    });
    expect(dropped.sort()).toEqual([
      "capacity.servers",
      "economics.monthlyRentCeilingCents",
      "targetCustomers",
    ]);
  });

  it("returns a null patch when nothing supported remains", () => {
    const { patch, dropped } = stripUnsupportedUnknowns(
      { economics: { startupBudgetCents: unknown() } },
      "Hello",
    );
    expect(patch).toBeNull();
    expect(dropped).toEqual(["economics.startupBudgetCents"]);
  });

  it("fills founder provenance for slim model entries without overriding existing origins", () => {
    expect(
      withFounderProvenance({
        economics: { monthlyRentCeilingCents: known(1) },
        mustHaves: {
          parking: {
            value: true,
            unit: "boolean",
            origin: "default",
            evidenceIds: ["x"],
          },
        },
      }),
    ).toEqual({
      economics: {
        monthlyRentCeilingCents: {
          value: 1,
          unit: "cents",
          origin: "founder",
          evidenceIds: ["founder-answer"],
        },
      },
      mustHaves: {
        parking: {
          value: true,
          unit: "boolean",
          origin: "default",
          evidenceIds: ["x"],
        },
      },
    });
  });
});
