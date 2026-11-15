import { expect, it } from "vitest";
import {
  answerPrompt,
  initialSession,
  intakeSessionSchema,
  missingFields,
  updateProfile,
} from "./profile";

it("accepts an unfinished intake session without requiring answers to every field", () => {
  expect(intakeSessionSchema.safeParse(initialSession).success).toBe(true);
  expect(
    missingFields(initialSession.profile).map((field) => field.key),
  ).toContain("concept");
});

it("uses current form edits when choosing the next field to ask about", () => {
  const profile = updateProfile(
    initialSession.profile,
    "concept",
    "Coffee and pastries",
  );
  const session = answerPrompt({ ...initialSession, profile }, "Montrose");
  expect(session.profile.areas).toEqual({
    value: "Montrose",
    origin: "founder",
  });
  expect(missingFields(session.profile)[0]?.key).toBe("rent");
});

it("marks an edited default as founder-provided", () => {
  expect(
    updateProfile(initialSession.profile, "city", "Los Angeles").city,
  ).toEqual({ value: "Los Angeles", origin: "founder" });
});

it("offline final form answers do not claim full agent completeness or discard known missing economics", () => {
  const session = {
    profile: {
      ...initialSession.profile,
      concept: { value: "Coffee", origin: "founder" as const },
      areas: { value: "Any", origin: "founder" as const },
      rent: { value: "4500", origin: "founder" as const },
      buildout: { value: "120000", origin: "founder" as const },
      price: { value: "Midrange", origin: "founder" as const },
      customers: { value: "Neighbors", origin: "founder" as const },
      hours: { value: "7am–5pm", origin: "founder" as const },
      staff: { value: "2", origin: "founder" as const },
    },
    messages: [],
    live: {
      state: { draft: {}, assumptions: {} },
      missingRequiredFields: ["economics.averageTicketCents"],
      findings: [],
    },
  };
  const answered = answerPrompt(session, "none");
  expect(answered.messages.at(-1)?.text).not.toMatch(
    /all the required fields|profile.*complete/i,
  );
  expect(answered.live?.missingRequiredFields).toEqual([
    "economics.averageTicketCents",
  ]);
  expect(answered.pending).toContain("requirements");
});
