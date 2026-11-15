import { describe, expect, it } from "vitest";
import {
  initialSession,
  type IntakeSession,
} from "@/components/intake/profile";
import { entryPlan, entryTarget, hasStarted } from "./entry";

const founder = (value: string) => ({ value, origin: "founder" as const });

const complete: IntakeSession = {
  profile: {
    concept: founder("Late-night dumpling counter"),
    category: founder("Quick-service food"),
    city: founder("Houston"),
    areas: founder("Favor Montrose"),
    rent: founder("4500"),
    buildout: founder("120000"),
    price: founder("Midrange"),
    customers: founder("Students"),
    hours: founder("11am – 11pm"),
    staff: founder("3"),
    requirements: founder("Vent hood"),
  },
  messages: initialSession.messages,
};

describe("landing entry target", () => {
  it("sends a first visit, or a session that only holds defaults, into the questionnaire", () => {
    for (const session of [null, initialSession]) {
      expect(entryTarget(session, "houston-coffee")).toEqual({
        kind: "onboarding",
        href: "/projects/houston-coffee/intake",
      });
    }
    expect(hasStarted(initialSession)).toBe(false);
  });

  it("offers a returning founder the workspace and the unfinished questions", () => {
    const partial: IntakeSession = {
      ...initialSession,
      profile: { ...initialSession.profile, concept: founder("Bakery") },
    };
    expect(entryTarget(partial, "houston-coffee")).toEqual({
      kind: "returning",
      complete: false,
      onboardingHref: "/projects/houston-coffee/intake",
      workspaceHref: "/projects/houston-coffee/workspace?step=locations",
    });
  });

  it("marks a fully answered profile complete", () => {
    expect(entryTarget(complete, "houston-coffee")).toMatchObject({
      kind: "returning",
      complete: true,
    });
  });

  it("counts a typed founder message as started", () => {
    expect(
      hasStarted({
        ...initialSession,
        messages: [...initialSession.messages, { role: "founder", text: "hi" }],
      }),
    ).toBe(true);
  });

  describe("which project /start opens (HAC-136)", () => {
    const own = "p-0123456789abcdef0123";
    const sessions =
      (map: Record<string, IntakeSession>) => (projectId: string) =>
        map[projectId] ?? null;

    it("creates a project for a first visit", () => {
      expect(entryPlan(null, sessions({}))).toEqual({ kind: "create" });
      // A demo session holding only defaults is not a started brief.
      expect(
        entryPlan(null, sessions({ "houston-coffee": initialSession })),
      ).toEqual({ kind: "create" });
    });

    it("reopens the remembered project, started or not", () => {
      expect(entryPlan(own, sessions({}))).toEqual({
        kind: "onboarding",
        href: `/projects/${own}/intake`,
        projectId: own,
      });
      expect(entryPlan(own, sessions({ [own]: complete }))).toMatchObject({
        kind: "returning",
        complete: true,
        projectId: own,
        workspaceHref: `/projects/${own}/workspace?step=locations`,
      });
    });

    it("resumes a brief started on the demo project before HAC-136", () => {
      expect(
        entryPlan(null, sessions({ "houston-coffee": complete })),
      ).toMatchObject({ kind: "returning", projectId: "houston-coffee" });
    });

    it("ignores a remembered ID that is not a project ID", () => {
      expect(entryPlan("../../admin", sessions({}))).toEqual({
        kind: "create",
      });
    });
  });
});
