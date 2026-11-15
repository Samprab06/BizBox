import { describe, expect, it, vi } from "vitest";
import { liveComparisonPayload } from "@/tests/e2e/live-comparison-fixtures";
import type { LiveComparisonPayload } from "./live-comparison";
import { finalizeChosenSite, MANUAL_RATIONALE } from "./finalize";
import {
  canOpenStep,
  initialFlowState,
  reachableSteps,
  withFinalPlan,
} from "./flow-steps";
import { resolveWorkspaceStep } from "@/components/workspace-screen/workspace-flow";

const payload = liveComparisonPayload as unknown as LiveComparisonPayload;
const chosen = payload.result.sites[0].siteId;
const base = {
  projectId: payload.result.projectId,
  payload,
  chosenSiteId: chosen,
  addresses: { [chosen]: "1 Main St" },
  fetchPlan: vi.fn(async () => null),
};

describe("finalizeChosenSite", () => {
  it("builds the summary with the default rationale for a manual choice", async () => {
    const summary = await finalizeChosenSite(base);
    expect(summary).toMatchObject({
      comparisonId: payload.comparisonId,
      chosenSiteId: chosen,
      chosenAddress: "1 Main St",
      rationale: MANUAL_RATIONALE,
    });
  });

  it("keeps the consultant's rationale", async () => {
    const summary = await finalizeChosenSite({
      ...base,
      rationale: "Best margin.",
    });
    expect(summary?.rationale).toBe("Best margin.");
  });

  it("flags a summary finalized from an outdated comparison", async () => {
    expect(
      (
        await finalizeChosenSite({
          ...base,
          payload: { ...payload, outdated: true },
        })
      )?.outdated,
    ).toBe(true);
    expect((await finalizeChosenSite(base))?.outdated).toBeUndefined();
  });

  it("refuses a site that is not in the comparison, or no comparison", async () => {
    expect(
      await finalizeChosenSite({ ...base, chosenSiteId: "9:9" }),
    ).toBeNull();
    expect(await finalizeChosenSite({ ...base, payload: null })).toBeNull();
  });
});

describe("opening the final step after finalizing", () => {
  it("lets the stepper and resolver reach finalize once a plan is stored", async () => {
    const summary = (await finalizeChosenSite(base))!;
    const locked = {
      ...initialFlowState(),
      reached: ["questions", "locations"] as const,
    };
    expect(
      resolveWorkspaceStep(
        "finalize",
        reachableSteps({ reached: [...locked.reached] }),
      ),
    ).toBe("locations");
    const next = withFinalPlan(
      { ...locked, reached: [...locked.reached] },
      summary,
    );
    expect(canOpenStep(next, "finalize")).toBe(true);
    expect(resolveWorkspaceStep("finalize", reachableSteps(next))).toBe(
      "finalize",
    );
  });
});
