import { createSpatialDraft } from "@/lib/spatial";
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
const draft = createSpatialDraft({
  projectId: payload.result.projectId,
  siteId: chosen,
  city: "houston",
});
const base = {
  interior: {
    comparisonId: payload.comparisonId,
    siteId: chosen,
    baseline: draft,
    draft,
    ranRevision: draft.revision,
    reviewedRevision: draft.revision,
  },
  projectId: payload.result.projectId,
  payload,
  chosenSiteId: chosen,
  addresses: { [chosen]: "1 Main St" },
  fetchPlan: vi.fn(async () => null),
};

describe("finalizeChosenSite", () => {
  it("refuses missing, stale or foreign interior review", async () => {
    expect(
      await finalizeChosenSite({ ...base, interior: undefined }),
    ).toBeNull();
    expect(
      await finalizeChosenSite({
        ...base,
        interior: { ...base.interior, reviewedRevision: null },
      }),
    ).toBeNull();
    expect(
      await finalizeChosenSite({
        ...base,
        interior: { ...base.interior, comparisonId: "other" },
      }),
    ).toBeNull();
  });
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

it("refuses reference-only approval without running the selected layout", async () => {
  const summary = await finalizeChosenSite({
    ...base,
    interior: {
      ...base.interior,
      ranRevision: null,
      reviewedRevision: null,
      reference: { modelId: "qfmMbTLt4Bo", selectedPlan: 1, reviewed: true },
    },
  });
  expect(summary).toBeNull();
});

it("carries the selected source into the final report instead of a reference café", async () => {
  const source = {
    kind: "scan" as const,
    modelId: "Synthetic01",
    provenance: {
      origin: "matterport" as const,
      provider: "matterport" as const,
      mode: "synthetic" as const,
      scope: "property" as const,
      description: "Synthetic building scan",
      limitations: ["Suite unverified"],
    },
  };
  const summary = await finalizeChosenSite({
    ...base,
    interior: {
      ...base.interior,
      source,
      reference: { modelId: "qfmMbTLt4Bo", selectedPlan: 1, reviewed: true },
    },
  });
  expect(summary?.interior?.source).toEqual(source);
  expect(summary?.referenceCafe).toBeUndefined();
});

import { getSpatialPolicyStates } from "@/lib/spatial";
it("requires a server-verified receipt before exporting Jev-backed evidence", async () => {
  const policy = {
    source: "jev" as const,
    modelVersion: "controlled-model",
    evidenceId: "controlled-evidence",
    states: getSpatialPolicyStates(draft).map((state) => ({
      ...state,
      stayByQueue: [{ lineLength: 0, p: 0.5 }],
    })),
  };
  const policies = { baseline: policy, variant: policy };
  const receipt = {
    version: 1 as const,
    digest: "a".repeat(64),
    signature: "b".repeat(64),
  };
  const interior = { ...base.interior, policies, policyReceipt: receipt };
  expect(
    await finalizeChosenSite({
      ...base,
      interior,
      verifyPolicies: async () => false,
    }),
  ).toBeNull();
  expect(
    await finalizeChosenSite({
      ...base,
      interior: { ...interior, policyReceipt: undefined },
      verifyPolicies: async () => true,
    }),
  ).toBeNull();
  const summary = await finalizeChosenSite({
    ...base,
    interior,
    verifyPolicies: async () => true,
  });
  expect(summary?.interior?.policies).toEqual(policies);
  expect(summary?.interior?.policyReceipt).toEqual(receipt);
});
