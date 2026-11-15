import { describe, expect, it } from "vitest";
import { fields } from "@/components/intake/profile";
import { BusinessProfileSchema } from "@/lib/contracts";
import { profileFromIntake } from "./intake-business-profile";

const values = {
  concept: "Neighborhood coffee for commuters",
  category: "Coffee shop",
  city: "Houston",
  areas: "Favor Montrose; avoid downtown",
  rent: "4000",
  buildout: "80000",
  price: "Midrange",
  customers: "Commuters",
  hours: "7am–5pm",
  staff: "2",
  requirements: "Ground floor, parking; corner not required",
};
const complete = () => ({
  profile: Object.fromEntries(
    fields.map(({ key }) => [key, { value: values[key], origin: "founder" }]),
  ),
  messages: [],
});

describe("browser intake to canonical profile", () => {
  it("uses founder answers, honest category defaults and explicit unknowns", () => {
    const result = profileFromIntake(complete(), "houston-coffee");
    const profile = BusinessProfileSchema.parse(result.profile);
    expect(profile.economics.monthlyRentCeilingCents).toMatchObject({
      value: 400_000,
      origin: "founder",
    });
    expect(profile.economics.buildoutBudgetCents.value).toBe(8_000_000);
    expect(profile.capacity.serviceMinutes.origin).toBe("default");
    expect(profile.economics.averageTicketCents.value).toBeNull();
    expect(profile.operatingHours).toEqual({
      openMinute: 420,
      closeMinute: 1020,
    });
    expect(profile.mustHaves.parking.value).toBe(true);
    expect(profile.mustHaves.corner.value).toBe(false);
    expect(profile.mustHaves.frontage.value).toBeNull();
    expect(profile.objective).toContain(values.areas);
    expect(profile.businessName).toBe(values.concept);
  });
  it("rejects incomplete/corrupt forms and unsafe money without a fixture substitution", () => {
    for (const raw of [
      null,
      { profile: {}, messages: [] },
      {
        ...complete(),
        profile: {
          ...complete().profile,
          rent: { value: "9007199254740991", origin: "founder" },
        },
      },
    ]) {
      expect(profileFromIntake(raw, "houston-coffee").profile).toBeNull();
    }
    expect(profileFromIntake(complete(), "other-project").profile).toBeNull();
  });
  it.each(["9-5", "7am-5", "overnight", "10pm–6am", "25:00-26:00"])(
    "does not invent opening-hour semantics for %s",
    (hours) => {
      const raw = complete();
      raw.profile.hours.value = hours;
      expect(profileFromIntake(raw, "houston-coffee").profile).toBeNull();
    },
  );
  it("supports explicit 24-hour ranges and no required features", () => {
    const raw = complete();
    raw.profile.hours.value = "07:30–24:00";
    raw.profile.requirements.value = "none";
    const { profile } = profileFromIntake(raw, "houston-coffee");
    expect(profile?.operatingHours.closeMinute).toBe(1440);
    expect(
      Object.values(profile!.mustHaves).every((flag) => flag.value === false),
    ).toBe(true);
  });
  it("does not turn optional or negated feature preferences into mandatory filters", () => {
    const raw = complete();
    raw.profile.requirements.value =
      "Ground floor required; don't need parking; corner isn't required; frontage would be nice";
    const { profile } = profileFromIntake(raw, "houston-coffee");
    expect(profile?.mustHaves.groundFloor.value).toBe(true);
    expect(profile?.mustHaves.parking.value).toBe(false);
    expect(profile?.mustHaves.corner.value).toBe(false);
    expect(profile?.mustHaves.frontage.value).toBe(false);
  });
});

it("keeps the numbered founder requirement verbatim alongside derived search flags", () => {
  const session = complete();
  const text =
    "Street frontage and a dedicated drive-up or street parking for 6 cars";
  session.profile.requirements!.value = text;
  const profile = profileFromIntake(session, "houston-coffee").profile;
  expect(profile?.objective).toContain(
    `Other requirements (verbatim): ${text}.`,
  );
  expect(profile?.mustHaves.frontage).toMatchObject({
    value: true,
    origin: "founder",
  });
  expect(profile?.mustHaves.parking).toMatchObject({
    value: true,
    origin: "founder",
  });
});
