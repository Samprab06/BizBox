import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  signInteriorPolicyReceipt,
  verifyInteriorPolicyReceipt,
} from "./policies-receipt";
import { createSpatialDraft, getSpatialPolicyStates } from "@/lib/spatial";
it("binds genuine preparation to project/comparison/drafts/policies and rejects forged client Jev labels", () => {
  const a = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    }),
    policy = {
      source: "jev" as const,
      modelVersion: "jev-test",
      evidenceId: "evidence",
      states: getSpatialPolicyStates(a).map((s) => ({
        ...s,
        stayByQueue: [{ lineLength: 0, p: 0.8 }],
      })),
    };
  const input = {
      projectId: "p",
      comparisonId: "c",
      baseline: a,
      variant: a,
      policies: { baseline: policy, variant: policy },
    },
    receipt = signInteriorPolicyReceipt(input, "test-secret");
  expect(verifyInteriorPolicyReceipt(input, receipt, "test-secret")).toBe(true);
  expect(verifyInteriorPolicyReceipt(input, receipt, "different-secret")).toBe(
    false,
  );
  expect(
    verifyInteriorPolicyReceipt(
      { ...input, comparisonId: "other" },
      receipt,
      "test-secret",
    ),
  ).toBe(false);
  expect(
    verifyInteriorPolicyReceipt(
      { ...input, variant: { ...a, revision: a.revision + 1 } },
      receipt,
      "test-secret",
    ),
  ).toBe(false);
  const changed = structuredClone(input);
  changed.policies.variant.states[0]!.stayByQueue[0]!.p = 0.99;
  expect(verifyInteriorPolicyReceipt(changed, receipt, "test-secret")).toBe(
    false,
  );
  expect(JSON.stringify(receipt)).not.toContain("test-secret");
});
