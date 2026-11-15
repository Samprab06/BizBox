import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSpatialDraft, getSpatialPolicyStates } from "@/lib/spatial";
import {
  signInteriorPolicyReceipt,
  verifyInteriorPolicyReceipt,
} from "@/lib/interior/policies-receipt";
import { InteriorPolicyError } from "@/lib/interior/policies";
import { createInteriorPolicyVerifyHandler } from "./handler";
it("verifies a scoped receipt and refuses modified policies without any provider work", async () => {
  const draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    }),
    policy = {
      source: "jev" as const,
      modelVersion: "jev-test",
      evidenceId: "evidence",
      states: getSpatialPolicyStates(draft).map((state) => ({
        ...state,
        stayByQueue: [{ lineLength: 0, p: 0.8 }],
      })),
    };
  const input = {
      projectId: "p",
      comparisonId: "c",
      baseline: draft,
      variant: draft,
      policies: { baseline: policy, variant: policy },
    },
    receipt = signInteriorPolicyReceipt(input, "test-secret");
  const handler = createInteriorPolicyVerifyHandler(async (body, received) => {
    if (!verifyInteriorPolicyReceipt(body, received, "test-secret"))
      throw new InteriorPolicyError("scope", "Invalid receipt");
    return { valid: true };
  });
  const request = (comparisonId: string) =>
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        comparisonId,
        baseline: draft,
        variant: draft,
        policies: input.policies,
        receipt,
      }),
    });
  expect(
    (
      await handler(request("c"), {
        params: Promise.resolve({ projectId: "p" }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await handler(request("forged"), {
        params: Promise.resolve({ projectId: "p" }),
      })
    ).status,
  ).toBe(403);
});
