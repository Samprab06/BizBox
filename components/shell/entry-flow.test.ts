import { describe, expect, it } from "vitest";
import { initialSession, updateProfile, type Profile } from "@/components/intake/profile";
import { questionSteps } from "@/components/onboarding/flow";
import type { UiAction } from "@/lib/contracts/agent";
import {
  answerCardStep,
  firstNavigate,
  isBriefComplete,
  isEntryPath,
  navigateHref,
  spacesHref,
} from "./entry-flow";

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

describe("isEntryPath", () => {
  it("matches only the project's own route", () => {
    expect(isEntryPath("/projects/p-1", "p-1")).toBe(true);
    expect(isEntryPath("/projects/p-1/", "p-1")).toBe(true);
    expect(isEntryPath("/projects/p-1/map", "p-1")).toBe(false);
    expect(isEntryPath("/projects/p-2", "p-1")).toBe(false);
  });
});

describe("isBriefComplete", () => {
  it("is false for the starting profile and true once every field is answered", () => {
    expect(isBriefComplete(initialSession.profile)).toBe(false);
    expect(isBriefComplete(undefined)).toBe(false);
    expect(isBriefComplete(complete)).toBe(true);
  });
});

describe("answerCardStep", () => {
  it("starts with the category chips, then waits for typed answers", () => {
    expect(answerCardStep(initialSession.profile)).toEqual({ kind: "choice", step: "category" });
    const typed = updateProfile(
      updateProfile(initialSession.profile, "category", "Coffee shop"),
      "concept",
      "A calm coffee shop",
    );
    // customers is next and is typed, so no card.
    expect(answerCardStep(typed)).toBeNull();
  });
  it("offers a ruler for rent and none once the brief is complete", () => {
    const upToRent = ["concept", "category", "customers", "city", "areas"].reduce<Profile>(
      (profile, step) => updateProfile(profile, step as "city", values[step]),
      initialSession.profile,
    );
    expect(answerCardStep(upToRent)).toEqual({ kind: "ruler", step: "rent" });
    expect(answerCardStep(complete)).toBeNull();
  });
});

describe("navigate actions", () => {
  const navigate = (extra: object): Extract<UiAction, { type: "navigate" }> =>
    ({ id: "a1", type: "navigate", stage: "map", ...extra }) as never;
  it("picks the first navigate action", () => {
    const highlight = { id: "h", type: "highlight", target: "map" } as UiAction;
    expect(firstNavigate([highlight])).toBeUndefined();
    expect(firstNavigate([highlight, navigate({})])?.stage).toBe("map");
  });
  it("routes stages and falls back to Spaces without a space", () => {
    expect(navigateHref("p-1", navigate({ stage: "map" }))).toBe("/projects/p-1/map");
    expect(navigateHref("p-1", navigate({ stage: "site", siteId: "montrose" }))).toBe(
      "/projects/p-1/sites/montrose",
    );
    expect(navigateHref("p-1", navigate({ stage: "interior" }))).toBe(spacesHref("p-1"));
  });
});
