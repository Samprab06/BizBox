import { describe, expect, it } from "vitest";
import { FLOW_STEP_IDS, UiActionSchema } from "@/lib/contracts/agent";
import {
  initialFlowState,
  reachStep,
  resetAfter,
  canOpenStep,
} from "./flow-steps";
import { planWorkspaceActions } from "./agent-jobs";

describe("interior experiment flow", () => {
  it("puts interior experiments between exterior results and final plan", () => {
    expect(FLOW_STEP_IDS.indexOf("interior" as never)).toBe(
      FLOW_STEP_IDS.indexOf("results") + 1,
    );
    const state = reachStep(initialFlowState(), "interior" as never);
    expect(canOpenStep(state, "interior" as never)).toBe(true);
    expect(canOpenStep(resetAfter(state, "compare"), "interior" as never)).toBe(
      false,
    );
  });

  it("accepts validated scoped edits and runs through consultant actions", () => {
    expect(
      UiActionSchema.safeParse({
        id: "edit",
        type: "spatial_edit",
        siteId: "1:1",comparisonId:"c",draftId:"d",expectedRevision:0,
        command: { type: "clear" },
      }).success,
    ).toBe(true);
    expect(
      UiActionSchema.safeParse({
        id: "edit",
        type: "spatial_edit",
        siteId: "1:1",comparisonId:"c",draftId:"d",expectedRevision:0,
        command: { type: "arbitrary" },
      }).success,
    ).toBe(false);
    const actions = [
      { id: "open", type: "open_interior", siteId: "1:1" },
    ] as Parameters<typeof planWorkspaceActions>[0];
    expect(
      planWorkspaceActions(actions, {
        candidateIds: ["1:1"],
        selectedIds: ["1:1"],
        flow: reachStep(initialFlowState(), "results"),
      }),
    ).toEqual([{ kind: "open_interior", siteId: "1:1" }]);
  });
});
