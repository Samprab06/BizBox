import { describe, expect, it } from "vitest";
import {
  areaMapMatchesCity,
  areaMapSummary,
  readAreaMap,
  writeAreaMap,
  type Mark,
  type Rectangle,
} from "./area-map-data";

describe("area map intake answers", () => {
  const marks: Mark[] = [{ lng: -95.3698, lat: 29.7604, brush: "favor" }];
  const rectangles: Rectangle[] = [
    { bounds: [-95.4, 29.7, -95.3, 29.8], brush: "favor" },
    { bounds: [-95.5, 29.8, -95.4, 29.9], brush: "avoid" },
  ];
  it("round trips rectangle geography and preserves existing answers and legacy brush marks", () => {
    const value = writeAreaMap(marks, "Houston", "Favor Montrose", rectangles);
    expect(readAreaMap(value, "Houston")).toEqual({
      marks,
      rectangles,
      previous: "Favor Montrose",
    });
    expect(areaMapSummary(value)).toContain(
      "Favor green-selected areas in Houston",
    );
    expect(areaMapSummary(value)).not.toContain('"rectangles"');
  });
  it("never caps or silently truncates selections", () => {
    const selections = Array.from({ length: 1000 }, (_, i): Rectangle => ({
      bounds: [-95.4, 29.7, -95.3 + i / 100000, 29.8],
      brush: i % 2 ? "favor" : "avoid",
    }));
    expect(
      readAreaMap(writeAreaMap([], "Houston", "", selections), "Houston")
        .rectangles,
    ).toEqual(selections);
  });
  it("clears selections without discarding the original written preference", () => {
    expect(writeAreaMap([], "Houston", "near offices", [])).toBe(
      "near offices",
    );
  });
  it("keeps city paintings separate and retains plain text", () => {
    const value = writeAreaMap([], "Houston", "", rectangles);
    expect(areaMapMatchesCity(value, "Los Angeles")).toBe(false);
    expect(readAreaMap(value, "Los Angeles").rectangles).toEqual([]);
    expect(readAreaMap("Favor Montrose", "Houston")).toEqual({
      previous: "Favor Montrose",
      marks: [],
      rectangles: [],
    });
  });
  it("rejects invalid coordinates and inverted rectangles", () => {
    expect(
      readAreaMap(
        writeAreaMap([{ lng: 900, lat: 0, brush: "favor" }], "Houston", "", [
          { bounds: [-95, 30, -96, 29], brush: "avoid" },
        ]),
        "Houston",
      ),
    ).toEqual({ previous: "", marks: [], rectangles: [] });
  });
});
