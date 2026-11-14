import { describe, expect, it } from "vitest";
import { simulatorDestination } from "./destination";

describe("legacy simulator destination", () => {
  it("opens the example inside the project workspace", () => {
    expect(simulatorDestination({})).toBe("/projects/houston-coffee/simulator");
  });
  it("preserves stored comparison, site, run and repeated parameters", () => {
    const result = new URL(
      simulatorDestination({
        project: "saved/project",
        comparison: "cmp:a/b",
        site: "site:a",
        run: "run:x",
        day: ["weekday", "weekend"],
      }),
      "http://localhost",
    );
    expect(result.pathname).toBe("/projects/saved%2Fproject/simulator");
    expect(result.searchParams.get("comparison")).toBe("cmp:a/b");
    expect(result.searchParams.get("site")).toBe("site:a");
    expect(result.searchParams.get("run")).toBe("run:x");
    expect(result.searchParams.getAll("day")).toEqual(["weekday", "weekend"]);
  });
  it("does not interpret repeated or empty project parameters as an identity", () => {
    expect(simulatorDestination({ project: ["a", "b"] })).toMatch(
      /^\/projects\/houston-coffee\//,
    );
    expect(simulatorDestination({ project: "" })).toMatch(
      /^\/projects\/houston-coffee\//,
    );
  });
});
