import { describe, expect, it } from "vitest";
import {
  unitLabel,
  toggleComparisonUnit,
  type WorkspaceCandidate,
} from "./client-model";
const unit = (id: string, propertyId = "building"): WorkspaceCandidate =>
  ({
    candidate: { id, address: "Test address" },
    propertyId,
  }) as WorkspaceCandidate;
describe("explicit unit comparison", () => {
  it("numbers source property units by stable IDs, independent of ranking or coincident coordinates", () => {
    const a = unit("space-2"),
      b = unit("space-10"),
      other = unit("space-1", "another-property");
    expect(unitLabel(a, [b, other, a])).toBe("Unit 1");
    expect(unitLabel(b, [a, b, other])).toBe("Unit 2");
    expect(unitLabel(other, [a, b, other])).toBe("Unit 1");
  });
  it("requires explicit additions, caps at three without replacement and supports removal", () => {
    expect(toggleComparisonUnit([], "a")).toEqual(["a"]);
    expect(toggleComparisonUnit(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleComparisonUnit(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleComparisonUnit(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleComparisonUnit(["a", "b"], "a")).toEqual(["b"]);
  });
});
