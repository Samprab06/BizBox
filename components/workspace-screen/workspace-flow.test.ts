import { describe, expect, it } from "vitest";
import {
  elapsedText,
  progressStages,
  resolveWorkspaceStep,
  topSiteIds,
  tweakChips,
  withoutTweak,
} from "./workspace-flow";

describe("resolveWorkspaceStep", () => {
  it("shows a reachable step, else the furthest reachable one before it", () => {
    const reachable = ["questions", "locations", "compare"] as const;
    expect(resolveWorkspaceStep("compare", reachable)).toBe("compare");
    expect(resolveWorkspaceStep("results", reachable)).toBe("compare");
    expect(resolveWorkspaceStep("finalize", ["questions"])).toBe("locations");
    expect(resolveWorkspaceStep("locations", ["questions"])).toBe("locations");
  });
});

describe("topSiteIds", () => {
  it("prefers the consultant's visible picks, else the best-ranked three", () => {
    const ids = ["a", "b", "c", "d"];
    expect(topSiteIds(null, ids)).toEqual(["a", "b", "c"]);
    expect(topSiteIds(["d", "x", "b"], ids)).toEqual(["d", "b"]);
    expect(topSiteIds(["x"], ids)).toEqual(["a", "b", "c"]);
  });
});

describe("progressStages", () => {
  it("tracks the Jev panel, then the simulation", () => {
    const start = progressStages("jev", null);
    expect(start.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
    const half = progressStages("jev", {
      completedPersonas: 20,
      totalPersonas: 40,
    });
    expect(half[0]).toMatchObject({ status: "active", fraction: 0.5 });
    expect(half[0].detail).toContain("20 of 40");
    const done = progressStages("jev", {
      completedPersonas: 40,
      totalPersonas: 40,
    });
    expect(done.map((s) => s.status)).toEqual(["done", "active", "pending"]);
  });

  it("marks the customer panel n/a for Huff", () => {
    expect(progressStages("huff", null).map((s) => s.status)).toEqual([
      "skipped",
      "active",
      "pending",
    ]);
  });
});

describe("tweak chips", () => {
  it("labels each tweak and removes one field at a time", () => {
    const tweaks = {
      hours: { openMinute: 420, closeMinute: 1170 },
      priceUsd: 7.5,
      staff: 3,
      monthlyRentUsd: 4200,
    };
    expect(tweakChips(tweaks).map((c) => c.label)).toEqual([
      "Hours 7am–7:30pm",
      "Avg ticket $7.50",
      "3 staff on shift",
      "Rent $4,200/mo",
    ]);
    expect(withoutTweak({ staff: 3 }, "staff")).toBeNull();
    expect(withoutTweak({ staff: 3, priceUsd: 7 }, "staff")).toEqual({
      priceUsd: 7,
    });
  });

  it("formats elapsed time", () => {
    expect(elapsedText(0)).toBe("0:00");
    expect(elapsedText(65_000)).toBe("1:05");
    expect(elapsedText(3_725_000)).toBe("1:02:05");
  });
});
