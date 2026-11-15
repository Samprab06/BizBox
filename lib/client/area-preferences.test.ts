import { describe, expect, it } from "vitest";
import { writeAreaMap, mapMarker } from "@/components/onboarding/area-map-data";
import { areaPreferencesFromAnswer } from "./area-preferences";

const rectangle = {
  bounds: [-95.5, 29.6, -95.3, 29.8] as [number, number, number, number],
  brush: "avoid" as const,
};
describe("saved area selection boundary", () => {
  it("keeps all drawn bounds and brushes without geocoding free text", () => {
    const raw = writeAreaMap([], "Houston", "near offices", [rectangle]);
    expect(areaPreferencesFromAnswer(raw, "Houston")).toEqual({
      preferences: { city: "Houston", rectangles: [rectangle] },
      mapped: true,
    });
    expect(areaPreferencesFromAnswer("Favor Montrose", "Houston")).toEqual({
      preferences: { city: "Houston", rectangles: [] },
      mapped: false,
    });
  });
  it("does not drop invalid red geometry or silently reuse another city's selections", () => {
    for (const raw of [
      "x" + mapMarker + "bad",
      writeAreaMap([], "Los Angeles", "", [rectangle]),
      "x" +
        mapMarker +
        JSON.stringify({
          city: "Houston",
          marks: [],
          rectangles: [[-95, 30, -96, 29, 1]],
        }),
      "x\n[BizBox area map v2] {}",
    ])
      expect(areaPreferencesFromAnswer(raw, "Houston").error).toBeTruthy();
  });
  it("requires legacy pixel-radius brush marks to be redrawn, not guessed geographically", () => {
    expect(
      areaPreferencesFromAnswer(
        writeAreaMap(
          [{ lng: -95.4, lat: 29.7, brush: "avoid" }],
          "Houston",
          "",
        ),
        "Houston",
      ).error,
    ).toContain("Redraw older brush");
  });
  it("supports explicit clearing and more than 200 rectangles", () => {
    expect(
      areaPreferencesFromAnswer("", "Houston").preferences.rectangles,
    ).toEqual([]);
    expect(
      areaPreferencesFromAnswer(
        writeAreaMap([], "Houston", "", Array(250).fill(rectangle)),
        "Houston",
      ).preferences.rectangles,
    ).toHaveLength(250);
  });
});
