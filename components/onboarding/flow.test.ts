import { describe, expect, it } from "vitest";
import { fields, initialSession, intakeSessionSchema, updateProfile, type Profile } from "@/components/intake/profile";
import { patchFromForm } from "@/components/intake/live";
import { profileFromIntake } from "@/lib/client/intake-business-profile";
import {
  categoryChoices,
  formatAreas,
  initialValue,
  nudge,
  parseAreas,
  priceChoices,
  questionSteps,
  resumeStep,
  reviewValue,
  rulerBounds,
  skipValues,
  stepError,
} from "./flow";

const intakeOptions = (key: string) => {
  const field = fields.find((entry) => entry.key === key);
  return field && "options" in field ? [...field.options] : [];
};

describe("field mapping", () => {
  it("maps the prototype's labels to the existing intake values", () => {
    expect(Object.fromEntries(categoryChoices.map((choice) => [choice.label, choice.value]))).toEqual({
      "Coffee shop": "Coffee shop",
      "Quick food": "Quick-service food",
      Salon: "Salon or barber",
      Fitness: "Fitness studio",
    });
    expect(Object.fromEntries(priceChoices.map((choice) => [choice.label, choice.value]))).toEqual({
      Value: "Budget",
      "Mid-range": "Midrange",
      Premium: "Premium",
    });
    expect(categoryChoices.map((choice) => choice.value)).toEqual(intakeOptions("category"));
    expect(priceChoices.map((choice) => choice.value)).toEqual(intakeOptions("price"));
  });

  it("asks one question per intake field", () => {
    expect([...questionSteps].sort()).toEqual(fields.map((field) => field.key).sort());
  });

  it("rejects Other and legacy categories", () => {
    expect(stepError("category", "Other")).toBe("Choose an available business type.");
    expect(stepError("category", "Quick food")).toBe("Choose an available business type.");
    expect(stepError("category", "Quick-service food")).toBeUndefined();
  });
});

describe("validation", () => {
  it("keeps exact whole dollar budgets within the guided limits", () => {
    expect(stepError("rent", "4550")).toBeUndefined();
    expect(stepError("rent", "20000")).toBeUndefined();
    expect(stepError("buildout", "1")).toBeUndefined();
    expect(stepError("buildout", "500000")).toBeUndefined();
    for (const value of ["", "0", "-5", "1e3", "99999999999"]) {
      expect(stepError("rent", value)).toBe("Enter a whole dollar amount from $1 to $20,000.");
      expect(stepError("buildout", value)).toBe("Enter a whole dollar amount from $1 to $500,000.");
    }
  });

  it("requires a whole positive staff count", () => {
    expect(stepError("staff", " ")).toBe("Enter how many people will be on shift.");
    expect(stepError("staff", "0")).toBe("Enter a positive whole number.");
    expect(stepError("staff", "2.5")).toBe("Enter a positive whole number.");
    expect(stepError("staff", "4")).toBeUndefined();
  });

  it("requires hours the map can read", () => {
    expect(stepError("hours", "7am – 6pm")).toBeUndefined();
    expect(stepError("hours", "mornings")).toMatch(/same-day range/);
    expect(stepError("hours", "")).toBe("Add your answer to continue.");
  });

  it("requires concept and customers", () => {
    expect(stepError("concept", "  ")).toBe("Add your answer to continue.");
    expect(stepError("customers", "Neighbors")).toBeUndefined();
  });
});

describe("areas", () => {
  it("round-trips favor/avoid picks and notes", () => {
    const text = formatAreas({ favor: ["Montrose", "The Heights"], avoid: ["Rice Village"], notes: "near offices" });
    expect(text).toBe("Favor Montrose, The Heights; Avoid Rice Village; near offices");
    expect(parseAreas(text, "Houston")).toEqual({
      favor: ["Montrose", "The Heights"],
      avoid: ["Rice Village"],
      notes: "near offices",
    });
  });

  it("keeps text typed in the detailed form, and other cities' picks, as notes", () => {
    expect(parseAreas("Avoid downtown; Favor Montrose", "Houston")).toEqual({
      favor: ["Montrose"],
      avoid: [],
      notes: "Avoid downtown",
    });
    expect(parseAreas("Favor Silver Lake", "Houston").notes).toBe("Favor Silver Lake");
    expect(parseAreas(skipValues.areas!, "Houston")).toEqual({ favor: [], avoid: [], notes: "" });
  });
});

describe("resume and defaults", () => {
  it("starts a new founder at the first question even though category and city have defaults", () => {
    expect(resumeStep(initialSession.profile)).toBe("category");
    expect(initialValue("category", initialSession.profile)).toBe("Coffee shop");
  });

  it("resumes at the first unconfirmed answer and goes to review when complete", () => {
    let profile: Profile = updateProfile(initialSession.profile, "category", "Salon or barber");
    profile = updateProfile(profile, "concept", "Barbershop");
    expect(resumeStep(profile)).toBe("customers");
    expect(resumeStep(completeProfile())).toBe("review");
  });

  it("starts hours at 9:00 AM – 5:00 PM unless a readable range is saved (HAC-154)", () => {
    expect(initialValue("hours", initialSession.profile)).toBe("09:00–17:00");
    expect(stepError("hours", initialValue("hours", initialSession.profile))).toBeUndefined();
    expect(initialValue("hours", updateProfile(initialSession.profile, "hours", "11am – 11pm"))).toBe("11am – 11pm");
    expect(initialValue("hours", updateProfile(initialSession.profile, "hours", "evenings"))).toBe("09:00–17:00");
    expect(reviewValue("hours", "09:00–22:15")).toBe("9:00 AM – 10:15 PM");
    expect(reviewValue("hours", "whenever")).toBe("whenever");
    // The default is not founder input until Continue saves it.
    expect(initialSession.profile.hours).toBeUndefined();
  });

  it("returns a legacy unsupported category to the category question without dropping answers", () => {
    const profile = { ...completeProfile(), category: { value: "Other", origin: "founder" as const } };
    expect(resumeStep(profile)).toBe("category");
    expect(initialValue("category", profile)).toBe("");
    expect(profile.concept?.value).toBe("Neighborhood coffee bar");
  });
});

describe("ruler helpers", () => {
  it("moves an exact value to the neighbouring detent", () => {
    expect(nudge(4550, 100, 500, 1)).toBe(4600);
    expect(nudge(4550, 100, 500, -1)).toBe(4500);
    expect(nudge(4500, 100, 500, 1)).toBe(4600);
    expect(nudge(4500, 100, 500, -1, 10)).toBe(3500);
  });

  it("keeps the ruler inside guided budget limits and includes low valid values", () => {
    expect(rulerBounds("rent", 50000)).toEqual({ min: 500, max: 20000 });
    expect(rulerBounds("rent", 100)).toEqual({ min: 100, max: 20000 });
    expect(rulerBounds("buildout", 0)).toEqual({ min: 5000, max: 500000 });
    expect(rulerBounds("staff", Number.NaN)).toEqual({ min: 1, max: 30 });
  });

  it("formats review values", () => {
    expect(reviewValue("rent", "4550")).toBe("$4,550");
    expect(reviewValue("category", "Salon or barber")).toBe("Salon");
    expect(reviewValue("price", "Midrange")).toBe("Mid-range");
    expect(reviewValue("staff", "3")).toBe("3 on shift");
  });

  it("labels chat-stated area preferences while preserving named areas and notes", () => {
    expect(reviewValue("areas", "Favor Montrose; Avoid Anything next to a major highway; Avoid US 59; near offices"))
      .toBe("Favor: Montrose; Avoid: anything next to a major highway; Avoid: US 59; near offices");
    expect(reviewValue("areas", "No preference")).toBe("No preference");
  });
});

/** The answers a founder gives in the guided flow, stored through updateProfile. */
function completeProfile(): Profile {
  const answers: Record<(typeof questionSteps)[number], string> = {
    category: "Coffee shop",
    concept: "Neighborhood coffee bar",
    customers: "Remote workers",
    city: "Houston",
    areas: formatAreas({ favor: ["Montrose"], avoid: [], notes: "" }),
    rent: "4550",
    buildout: "80000",
    price: "Midrange",
    hours: "7am – 6pm",
    staff: "2",
    requirements: skipValues.requirements!,
  };
  return questionSteps.reduce((profile, key) => updateProfile(profile, key, answers[key]), initialSession.profile);
}

describe("completed onboarding", () => {
  it("produces a saved intake session the map and comparison accept", () => {
    const session = intakeSessionSchema.parse(JSON.parse(JSON.stringify({ ...initialSession, profile: completeProfile() })));
    for (const key of questionSteps) expect(session.profile[key]?.origin).toBe("founder");
    const result = profileFromIntake(session, "houston-coffee");
    expect(result.reason).toBeNull();
    expect(result.profile?.economics.monthlyRentCeilingCents.value).toBe(455000);
    expect(result.profile?.category).toBe("coffee");
    expect(result.profile?.objective).toContain("Favor Montrose");
    expect(result.profile?.mustHaves.parking.value).toBe(false);
  });

  it("sends every guided answer as a founder patch to the live intake", () => {
    const patch = patchFromForm(completeProfile(), [...questionSteps]);
    expect(patch).toMatchObject({
      concept: "Neighborhood coffee bar",
      category: "coffee",
      city: "Houston",
      targetCustomers: ["Remote workers"],
      operatingHours: { openMinute: 420, closeMinute: 1080 },
      economics: { monthlyRentCeilingCents: { value: 455000 }, priceTier: { value: "mid" } },
    });
  });
});
