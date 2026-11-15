import { describe, expect, it } from "vitest";
import { createIntakeSession } from "@/lib/agent/intake";
import { founderAnswers } from "@/lib/agent/__fixtures__/founder";
import { applyIntakeReply } from "@/components/workspace-screen/intake-conversation";
import { patchFromForm } from "./live";
import { editIntakeField, type IntakeSession } from "./profile";
import { intakeReadiness } from "./readiness";

const founder = (value: string) => ({ value, origin: "founder" as const });
const form: IntakeSession["profile"] = {
  concept: founder("Neighborhood coffee"),
  category: founder("Coffee shop"),
  city: founder("Houston"),
  areas: founder("Favor Montrose"),
  rent: founder("4500"),
  buildout: founder("120000"),
  price: founder("Midrange"),
  customers: founder("Remote workers"),
  hours: founder("7am–5pm"),
  staff: founder("2"),
  requirements: founder("none"),
};
const complete = (): IntakeSession => ({
  profile: form,
  messages: [],
  live: {
    state: { draft: {}, assumptions: {} },
    missingRequiredFields: [],
    findings: [],
  },
});

describe("intake readiness uses the agent's full-profile completeness", () => {
  it("does not call guided-form-only answers complete while authoritative economics are missing", () => {
    const agent = createIntakeSession("houston-coffee");
    const result = agent.saveProfile(
      patchFromForm(form, Object.keys(form) as (keyof typeof form)[]),
    );
    const session: IntakeSession = {
      profile: form,
      messages: [],
      live: {
        state: { draft: result.draft, assumptions: result.assumptions },
        missingRequiredFields: result.missingRequiredFields,
        findings: result.findings,
      },
    };
    expect(result.missingRequiredFields).toEqual(
      expect.arrayContaining([
        "economics.averageTicketCents",
        "economics.startupBudgetCents",
        "economics.monthlyOperatingBudgetCents",
      ]),
    );
    const readiness = intakeReadiness(session);
    expect(readiness.complete).toBe(false);
    expect(readiness.missingRequiredFields).toEqual(
      result.missingRequiredFields,
    );
    expect(readiness.message).toMatch(/assistant.*economics.*chat/i);
  });
  it("leaves a filled form unreviewed when there is no authoritative agent result", () => {
    const readiness = intakeReadiness({ profile: form, messages: [] });
    expect(readiness.complete).toBe(false);
    expect(readiness.missingRequiredFields).toBeNull();
    expect(readiness.message).toMatch(/not.*reviewed/i);
  });
  it("confirms completion after the agent has no missing fields and the form is valid", () => {
    const agent = createIntakeSession("houston-coffee");
    for (const answer of founderAnswers) agent.saveProfile(answer);
    const snapshot = agent.snapshot();
    expect(
      intakeReadiness({
        ...complete(),
        live: {
          state: { draft: snapshot.draft, assumptions: snapshot.assumptions },
          missingRequiredFields: snapshot.missingRequiredFields,
          findings: snapshot.findings,
        },
      }).complete,
    ).toBe(true);
  });
  it("does not trust prior agent completion after offline local edits until a fresh reply reviews them", () => {
    const before = complete();
    const edited = editIntakeField(before, "rent", "5000", false);
    expect(intakeReadiness(edited).complete).toBe(false);
    expect(intakeReadiness(edited).message).toMatch(/review/i);
    const reviewed = applyIntakeReply(
      edited,
      edited,
      {
        draft: {},
        assumptions: {},
        missingRequiredFields: [],
        findings: [],
        nextQuestion: null,
        assistantMessage: "Reviewed.",
      },
      false,
    );
    expect(intakeReadiness(reviewed).complete).toBe(true);
  });
  it("keeps invalid form fields incomplete even with an empty authoritative missing list", () => {
    expect(
      intakeReadiness({
        ...complete(),
        profile: { ...form, rent: founder("invalid") },
      }).complete,
    ).toBe(false);
  });
  it("keeps known required fields visible while form edits await review", () => {
    const session = complete();
    session.live!.missingRequiredFields = ["economics.averageTicketCents"];
    const readiness = intakeReadiness(
      editIntakeField(session, "rent", "5000", false),
    );
    expect(readiness.complete).toBe(false);
    expect(readiness.missingRequiredFields).toEqual([
      "economics.averageTicketCents",
    ]);
    expect(readiness.message).toMatch(/economics/);
  });
});

it("treats invalid unsaved form drafts as incomplete without changing saved founder answers", () => {
  const session = complete();
  expect(intakeReadiness(session, { rent: "invalid" }).complete).toBe(false);
  expect(session.profile.rent?.value).toBe("4500");
});
