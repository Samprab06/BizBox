import { describe, expect, it } from "vitest";
import {
  activeComparisonId,
  readShortlist,
  restoreShortlist,
  shortlistStorageKey,
} from "./project-store";

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

describe("project store", () => {
  it("prefers a single ?comparison= over the saved comparison", () => {
    const saved = {
      projectId: "p",
      comparisonId: "saved",
      profileId: "profile",
      profileVersion: 1,
      intakeFingerprint: "",
    };
    expect(activeComparisonId("http://x/p/plan?comparison=url", saved)).toBe(
      "url",
    );
    expect(activeComparisonId("http://x/p/plan", saved)).toBe("saved");
    expect(
      activeComparisonId("http://x/p/plan?comparison=a&comparison=b", saved),
    ).toBe("saved");
    expect(activeComparisonId("http://x/p/plan", null)).toBeUndefined();
  });

  it("reads only a valid shortlist for the project", () => {
    const key = shortlistStorageKey("p");
    expect(readShortlist(storage({ [key]: '["1:2","3:4","1:2"]' }), "p")).toEqual(
      ["1:2", "3:4"],
    );
    expect(readShortlist(storage({ [key]: '["1:2"]' }), "other")).toBeNull();
    expect(readShortlist(storage({ [key]: "{" }), "p")).toBeNull();
    expect(readShortlist(storage({ [key]: '[1]' }), "p")).toBeNull();
    expect(
      readShortlist(
        {
          getItem: () => {
            throw new Error("denied");
          },
        },
        "p",
      ),
    ).toBeNull();
  });

  it("restores the saved shortlist against the current candidates", () => {
    expect(restoreShortlist(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(restoreShortlist(["b", "gone"], ["a", "b"])).toEqual(["b"]);
    expect(restoreShortlist([], ["a", "b"])).toEqual([]);
  });
});
