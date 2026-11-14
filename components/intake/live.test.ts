import { describe, expect, it } from "vitest";
import { assumptionRows, formFromDraft, patchFromForm } from "./live";
import { intakeSessionSchema } from "./profile";
import { createIntakeSession } from "@/lib/agent/intake";

const founder = (value: string) => ({ value, origin: "founder" as const });

describe("HAC-66 intake form ↔ API draft", () => {
  it("turns founder form edits into a patch the intake session accepts", () => {
    const profile = {
      concept: founder("Neighborhood coffee"),
      category: founder("Coffee shop"),
      city: founder("Houston"),
      rent: founder("4500"),
      buildout: founder("120000"),
      price: founder("Midrange"),
      customers: founder("Remote workers"),
      hours: founder("7am to 5pm"),
      staff: founder("2"),
      requirements: founder("Parking nearby"),
      areas: founder("Favor Montrose"),
    };
    const patch = patchFromForm(profile, Object.keys(profile) as (keyof typeof profile)[]);
    const snapshot = createIntakeSession("houston-coffee").saveProfile(patch);
    expect(snapshot.draft.category).toBe("coffee");
    expect(snapshot.draft.economics?.monthlyRentCeilingCents?.value).toBe(450000);
    expect(snapshot.draft.economics?.priceTier?.value).toBe("mid");
    expect(snapshot.draft.operatingHours).toEqual({ openMinute: 420, closeMinute: 1020 });
    expect(snapshot.draft.capacity?.servers?.origin).toBe("founder");
    expect(snapshot.draft.mustHaves?.parking?.value).toBe(true);

    const form = formFromDraft(snapshot.draft);
    expect(form).toMatchObject({
      concept: founder("Neighborhood coffee"),
      category: founder("Coffee shop"),
      rent: founder("4500"),
      buildout: founder("120000"),
      price: founder("Midrange"),
      hours: founder("07:00–17:00"),
      staff: founder("2"),
    });
    // Free-text areas are left to the conversation.
    expect(form.areas).toBeUndefined();
  });

  it("only patches edited founder fields and skips defaults", () => {
    expect(
      patchFromForm({ category: { value: "Coffee shop", origin: "default" } }, ["category"]),
    ).toBeUndefined();
    expect(patchFromForm({ city: founder("Houston"), concept: founder("x") }, ["city"])).toEqual({ city: "Houston" });
  });

  it("reports assumption origins, including category defaults", () => {
    const snapshot = createIntakeSession("houston-coffee").saveProfile({ category: "coffee" });
    const rows = assumptionRows(snapshot.assumptions);
    expect(rows.map((r) => r.key)).toContain("visitsPerMonth");
    expect(rows.every((r) => r.origin === "default")).toBe(true);
  });

  it("a damaged stored live state keeps the founder's answers", () => {
    const parsed = intakeSessionSchema.parse({
      profile: { concept: founder("x") },
      messages: [],
      live: { state: "broken" },
    });
    expect(parsed.profile.concept?.value).toBe("x");
    expect(parsed.live).toBeUndefined();
  });
});
