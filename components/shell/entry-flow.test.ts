import { describe, expect, it } from "vitest";
import { initialSession, updateProfile, type Profile } from "@/components/intake/profile";
import { questionSteps } from "@/components/onboarding/flow";
import { entryPath, isBriefComplete } from "./entry-flow";

const values: Record<string, string> = {
  concept: "Late-night dumpling counter",
  category: "Quick-service food",
  city: "Houston",
  areas: "No preference",
  rent: "4500",
  buildout: "120000",
  price: "Midrange",
  customers: "Students",
  hours: "11am – 11pm",
  staff: "3",
  requirements: "None",
};
const complete = questionSteps.reduce<Profile>(
  (profile, step) => updateProfile(profile, step, values[step]),
  initialSession.profile,
);

describe("entryPath", () => {
  it("encodes the project's own route", () => {
    expect(entryPath("p-1")).toBe("/projects/p-1");
    expect(entryPath("a b")).toBe("/projects/a%20b");
  });
});

describe("isBriefComplete", () => {
  it("is false for the starting profile and true once every field is answered", () => {
    expect(isBriefComplete(initialSession.profile)).toBe(false);
    expect(isBriefComplete(undefined)).toBe(false);
    expect(isBriefComplete(complete)).toBe(true);
  });
});
