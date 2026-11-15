import { describe, expect, it } from "vitest";
import { shownCandidates } from "./shown-candidates";

const c = (id: string) => ({ candidate: { id } });
const all = ["a", "b", "c", "d", "e"].map(c);

describe("shownCandidates", () => {
  it("shows only the top picks by default", () => {
    expect(
      shownCandidates(all, ["a", "b", "c"], [], undefined).map(
        (e) => e.candidate.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });
  it("adds chosen and open sites once, ignoring unknown ids", () => {
    expect(
      shownCandidates(all, ["a", "b", "c"], ["e", "a", "zz"], "d").map(
        (e) => e.candidate.id,
      ),
    ).toEqual(["a", "b", "c", "e", "d"]);
  });
});
