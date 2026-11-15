import { describe, expect, it } from "vitest";
import {
  copilotRuntimeFixtures,
  createCopilotRuntimeFixture,
} from "@/fixtures/copilot-runtime";
import {
  CopilotContextSchema,
  CopilotEventSchema,
  CopilotTurnRequestSchema,
  CopilotSourceLabelSchema,
  copilotContextMatches,
} from "./copilot-runtime";

const context = copilotRuntimeFixtures[0].context;

describe("copilot runtime contract", () => {
  it("publishes deterministic offline examples for both cities and every supported category", () => {
    expect(copilotRuntimeFixtures).toHaveLength(8);
    expect(
      new Set(copilotRuntimeFixtures.map((f) => `${f.city}:${f.category}`))
        .size,
    ).toBe(8);
    for (const fixture of copilotRuntimeFixtures) {
      expect(
        createCopilotRuntimeFixture(fixture.city, fixture.category),
      ).toEqual(fixture);
      fixture.events.forEach((event, index) => {
        expect(CopilotEventSchema.parse(event)).toEqual(event);
        expect(event.sequence).toBe(index);
      });
    }
  });

  it.each([
    "projectId",
    "profileId",
    "siteId",
    "scenarioId",
    "runId",
    "selectedCustomerId",
    "chartId",
  ])("rejects blank %s", (field) => {
    expect(
      CopilotContextSchema.safeParse({ ...context, [field]: "  " }).success,
    ).toBe(false);
  });

  it.each([
    { minute: -1 },
    { minute: 1440 },
    { minute: 2.5 },
    { profileVersion: 0 },
    { revision: -1 },
    { day: "monday" },
    { view: "other" },
    { page: "" },
  ])("rejects invalid playback/selection context %j", (patch) => {
    expect(
      CopilotContextSchema.safeParse({ ...context, ...patch }).success,
    ).toBe(false);
  });

  it("allows an unfinished intake without fabricated selected IDs", () => {
    expect(
      CopilotContextSchema.safeParse({
        projectId: "p",
        page: "/intake",
        view: "intake",
        revision: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects stale results on every context dimension, including revision", () => {
    expect(copilotContextMatches(context, { ...context })).toBe(true);
    for (const [field, value] of Object.entries(context)) {
      const changed =
        typeof value === "number" ? value + 1 : `${value}:changed`;
      expect(
        copilotContextMatches(context, { ...context, [field]: changed }),
        field,
      ).toBe(false);
    }
    expect(
      copilotContextMatches(context, { ...context, siteId: undefined }),
    ).toBe(false);
    expect(copilotContextMatches({}, {})).toBe(false);
  });

  it("bounds and strictly validates turn input without accepting model authorization", () => {
    const input = {
      message: "Make this cheaper",
      context,
      requestId: "request",
    };
    expect(CopilotTurnRequestSchema.safeParse(input).success).toBe(true);
    expect(
      CopilotTurnRequestSchema.safeParse({ ...input, runConfirmed: true })
        .success,
    ).toBe(false);
    expect(
      CopilotTurnRequestSchema.safeParse({
        ...input,
        message: "x".repeat(8001),
      }).success,
    ).toBe(false);
    expect(
      CopilotTurnRequestSchema.safeParse({
        ...input,
        proposalAction: { proposalId: "proposal", action: "run" },
      }).success,
    ).toBe(true);
  });

  it("requires truthful evidence and interior source labels", () => {
    expect(
      CopilotSourceLabelSchema.safeParse({
        kind: "real_evidence",
        label: "CoStar",
        evidenceIds: [],
      }).success,
    ).toBe(false);
    expect(
      CopilotSourceLabelSchema.safeParse({
        kind: "real_evidence",
        label: "CoStar",
        evidenceIds: ["e"],
        origin: "costar",
      }).success,
    ).toBe(true);
    expect(
      CopilotSourceLabelSchema.safeParse({
        kind: "interior",
        label: "Interior",
        evidenceIds: [],
      }).success,
    ).toBe(false);
  });

  it("validates typed limit/error events and rejects unknown event payload fields", () => {
    const base = { threadId: "thread", turnId: "turn", sequence: 0, context };
    expect(
      CopilotEventSchema.safeParse({
        ...base,
        type: "limit",
        reason: "wall_time",
        message: "Resume to continue",
        resumable: true,
      }).success,
    ).toBe(true);
    expect(
      CopilotEventSchema.safeParse({
        ...base,
        type: "error",
        code: "STALE_CONTEXT",
        message: "Selection changed",
      }).success,
    ).toBe(true);
    expect(
      CopilotEventSchema.safeParse({
        ...base,
        type: "limit",
        reason: "wall_time",
      }).success,
    ).toBe(false);
    expect(
      CopilotEventSchema.safeParse({
        ...base,
        type: "turn_started",
        requestId: "r",
        apiKey: "secret",
      }).success,
    ).toBe(false);
  });
});
