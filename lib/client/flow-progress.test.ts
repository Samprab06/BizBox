import { describe, expect, it } from "vitest";
import { FlowEventSchema, UiActionSchema } from "@/lib/contracts/agent";
import { SiteTweaksSchema } from "@/lib/contracts/evaluation";
import { IntakeRequestSchema } from "@/lib/contracts/intake";
import { AssemblyShortcutSchema } from "@/lib/evaluation/assemble";
import {
  canOpenStep,
  flowStepFromLocation,
  flowStepHref,
  initialFlowState,
  parseFlowState,
  reachStep,
  reachableSteps,
  resetAfter,
  withFinalPlan,
  withSiteTweaks,
} from "./flow-progress";

const plan = {
  projectId: "p",
  comparisonId: "c1",
  chosenSiteId: "1:2",
  chosenAddress: "100 Main St",
  rationale: "Highest contribution with a short wait.",
  finalizedAt: "2026-11-15T12:00:00.000Z",
  demandSource: "huff" as const,
  metrics: {
    monthlyServedCustomers: { mean: 3000, low: 2600, high: 3400 },
    monthlyContributionUsd: { mean: 9000, low: 7000, high: 11000 },
  },
  runnerUp: null,
  risks: [],
  nextSteps: ["Tour the space."],
};

describe("flow progress", () => {
  it("maps steps to URLs and back", () => {
    expect(flowStepHref("p 1", "questions")).toBe("/projects/p%201/intake");
    expect(flowStepHref("p", "compare")).toBe(
      "/projects/p/workspace?step=compare",
    );
    expect(flowStepFromLocation("/projects/p/intake", "")).toBe("questions");
    expect(flowStepFromLocation("/projects/p/workspace", "?step=results")).toBe(
      "results",
    );
    expect(flowStepFromLocation("/projects/p/workspace", "")).toBe("locations");
    expect(flowStepFromLocation("/projects/p/workspace", "?step=nope")).toBe(
      "locations",
    );
    expect(flowStepFromLocation("/projects/p/map", "")).toBeNull();
  });

  it("unlocks a step and everything before it, and locks later steps on reset", () => {
    const start = initialFlowState();
    expect(reachableSteps(start)).toEqual(["questions"]);
    expect(canOpenStep(start, "locations")).toBe(false);
    const atResults = reachStep(start, "results");
    expect(reachableSteps(atResults)).toEqual([
      "questions",
      "locations",
      "compare",
      "results",
    ]);
    expect(reachStep(atResults, "compare")).toBe(atResults);
    const finalized = withFinalPlan(atResults, plan);
    expect(canOpenStep(finalized, "finalize")).toBe(true);
    const reset = resetAfter(finalized, "locations");
    expect(reachableSteps(reset)).toEqual(["questions", "locations"]);
    expect(reset.finalPlan).toBeNull();
  });

  it("stores and clears per-site tweaks", () => {
    const tweaked = withSiteTweaks(initialFlowState(), "1:2", {
      staff: 3,
      monthlyRentUsd: 5200,
    });
    expect(tweaked.siteTweaks["1:2"]).toEqual({
      staff: 3,
      monthlyRentUsd: 5200,
    });
    expect(withSiteTweaks(tweaked, "1:2", {}).siteTweaks).toEqual({});
  });

  it("falls back to the initial state for unreadable storage", () => {
    expect(parseFlowState(null)).toEqual(initialFlowState());
    expect(parseFlowState("{bad")).toEqual(initialFlowState());
    expect(parseFlowState(JSON.stringify({ reached: ["nope"] }))).toEqual(
      initialFlowState(),
    );
    const stored = withFinalPlan(
      reachStep(initialFlowState(), "results"),
      plan,
    );
    expect(parseFlowState(JSON.stringify(stored))).toEqual(stored);
  });
});

describe("Scene 1 contracts", () => {
  it("validates site tweaks", () => {
    expect(
      SiteTweaksSchema.safeParse({
        hours: { openMinute: 420, closeMinute: 1140 },
        priceUsd: 6.5,
      }).success,
    ).toBe(true);
    expect(
      SiteTweaksSchema.safeParse({
        hours: { openMinute: 600, closeMinute: 500 },
      }).success,
    ).toBe(false);
    expect(
      AssemblyShortcutSchema.safeParse({
        projectId: "p",
        profileId: "f",
        candidateIds: ["1:2", "3:4"],
        siteTweaks: { "1:2": { staff: 4 } },
      }).success,
    ).toBe(true);
  });

  it("accepts the new consultant actions and flow events", () => {
    for (const action of [
      { id: "a", type: "present_top_sites", siteIds: ["1:2", "3:4", "5:6"] },
      {
        id: "b",
        type: "set_site_tweaks",
        candidateId: "1:2",
        tweaks: { staff: 2 },
      },
      { id: "c", type: "go_to_step", step: "compare" },
      {
        id: "d",
        type: "finalize_plan",
        comparisonId: "c1",
        chosenSiteId: "1:2",
        rationale: "Best margin.",
      },
    ])
      expect(UiActionSchema.safeParse(action).success).toBe(true);
    expect(
      UiActionSchema.safeParse({
        id: "e",
        type: "present_top_sites",
        siteIds: ["1", "2", "3", "4"],
      }).success,
    ).toBe(false);
    expect(
      FlowEventSchema.safeParse({
        kind: "comparison_progress",
        completed: 4,
        total: 10,
      }).success,
    ).toBe(true);
    expect(
      IntakeRequestSchema.safeParse({ event: { kind: "arrived_workspace" } })
        .success,
    ).toBe(true);
    expect(
      IntakeRequestSchema.safeParse({
        message: "hi",
        event: { kind: "arrived_workspace" },
      }).success,
    ).toBe(false);
  });
});
