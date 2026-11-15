import { describe, expect, it } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createIntakeSession } from "@/lib/agent/intake";
import { BusinessProfileSchema } from "./index";
import { IntakeDraftSchema, IntakePatchSchema } from "./intake";

const preferences = {
  city: "Houston",
  rectangles: [{ bounds: [-95.5, 29.6, -95.3, 29.8], brush: "favor" }],
};
const profile = (areaPreferences: unknown) => ({
  ...syntheticHoustonFixture.profile,
  areaPreferences,
});

describe("founder map preferences", () => {
  it("preserves rectangle geometry through canonical profiles and browser intake edits", () => {
    expect(BusinessProfileSchema.parse(profile(preferences))).toHaveProperty(
      "areaPreferences",
      preferences,
    );
    const draft = IntakeDraftSchema.parse({
      city: "Houston",
      areaPreferences: preferences,
    });
    const session = createIntakeSession("project", { draft, assumptions: {} });
    expect(
      session.saveProfile({ concept: "Edited concept" }).draft,
    ).toHaveProperty("areaPreferences", preferences);
    expect(
      session.saveProfile({
        areaPreferences: { city: "Houston", rectangles: [] },
      }).draft,
    ).toHaveProperty("areaPreferences.rectangles", []);
    expect(
      IntakePatchSchema.safeParse({ areaPreferences: preferences }).success,
    ).toBe(true);
  });

  it("accepts omitted preferences, explicit clearing and more than 200 selections", () => {
    expect(
      BusinessProfileSchema.safeParse(syntheticHoustonFixture.profile).success,
    ).toBe(true);
    expect(
      BusinessProfileSchema.safeParse(
        profile({ city: "Houston", rectangles: [] }),
      ).success,
    ).toBe(true);
    expect(
      BusinessProfileSchema.safeParse(
        profile({
          ...preferences,
          rectangles: Array.from(
            { length: 201 },
            () => preferences.rectangles[0],
          ),
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    { ...preferences, city: "Los Angeles" },
    { ...preferences, city: "Boston" },
    { ...preferences, marks: [] },
    {
      ...preferences,
      rectangles: [
        { bounds: [-95.5, 29.6, -95.3, 29.8], brush: "favor", extra: true },
      ],
    },
    ...[
      [-95.3, 29.6, -95.5, 29.8],
      [-95.5, 29.8, -95.3, 29.6],
      [-95.5, 29.6, -95.5, 29.8],
      [-181, 29.6, -95.3, 29.8],
      [-95.5, -91, -95.3, 29.8],
      [-95.5, 29.6, Infinity, 29.8],
      [-95.5, 29.6, -95.3, NaN],
      [-95.5, 29.6, -95.3],
    ].map((bounds) => ({
      ...preferences,
      rectangles: [{ bounds, brush: "favor" }],
    })),
    {
      ...preferences,
      rectangles: [{ bounds: [-95.5, 29.6, -95.3, 29.8], brush: "exclude" }],
    },
  ])("rejects invalid geometry, unknown fields and stale city: %j", (value) => {
    expect(BusinessProfileSchema.safeParse(profile(value)).success).toBe(false);
  });

  it("rejects a completed draft with geometry from another city", () => {
    const draft = IntakeDraftSchema.safeParse({
      city: "Los Angeles",
      areaPreferences: preferences,
    });
    expect(draft.success).toBe(false);
  });

  it("clears inherited map geometry when chat changes city, while rejecting supplied mismatches", () => {
    const session = createIntakeSession("project", {
      draft: {
        city: "Houston",
        areaPreferences: BusinessProfileSchema.parse(profile(preferences))
          .areaPreferences,
      },
      assumptions: {},
    });
    expect(session.saveProfile({ city: "Los Angeles" }).draft).toMatchObject({
      city: "Los Angeles",
    });
    expect(session.snapshot().draft.areaPreferences).toBeUndefined();
    expect(() =>
      session.saveProfile({
        city: "Los Angeles",
        areaPreferences: preferences,
      }),
    ).toThrow();
    expect(session.snapshot().draft.city).toBe("Los Angeles");
    expect(session.snapshot().draft.areaPreferences).toBeUndefined();
  });
});
