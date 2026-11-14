import { describe, expect, it } from "vitest";
import { customerLabel } from "./customer-label";

describe("customer decision labels", () => {
  it("does not present reconstructed stored decisions as 100% or 0% probability", () => {
    for (const [decision, stayProbability] of [
      ["join", 1],
      ["leave", 0],
    ] as const) {
      const label = customerLabel(
        { lineLength: 6, stayProbability, decision },
        true,
      );
      expect(label).toContain(
        decision === "join" ? "recorded joined" : "recorded left",
      );
      expect(label).toContain("join probability not stored");
      expect(label).not.toContain("%");
    }
  });
  it("keeps the fixture's actual modeled probability beside its observed line", () => {
    expect(
      customerLabel(
        { lineLength: 6, stayProbability: 0.31, decision: "leave" },
        false,
      ),
    ).toBe("6 in line · 31% modeled join probability · left");
  });
});
