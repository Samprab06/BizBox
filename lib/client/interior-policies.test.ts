import { describe, expect, it, vi } from "vitest";
import { createSpatialDraft, getSpatialPolicyStates } from "@/lib/spatial";
import {
  fetchInteriorPolicies,
  verifyInteriorPolicies,
} from "./interior-policies";
const draft = createSpatialDraft({
  projectId: "p",
  siteId: "s",
  city: "houston",
});
const policy = {
  source: "jev" as const,
  modelVersion: "test-model",
  evidenceId: "controlled-provider-response",
  states: getSpatialPolicyStates(draft).map((state) => ({
    ...state,
    stayByQueue: [{ lineLength: 0, p: 0.8 }],
  })),
};
const receipt = {
  version: 1 as const,
  digest: "a".repeat(64),
  signature: "b".repeat(64),
};
describe("explicit interior policy preparation", () => {
  it("uses selected snapshots and validates the returned provider policies", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({
        policies: { baseline: policy, variant: policy },
        receipt,
      }),
    );
    expect(
      await fetchInteriorPolicies(
        "p",
        { comparisonId: "c", baseline: draft, variant: draft },
        new AbortController().signal,
        request,
      ),
    ).toEqual({ policies: { baseline: policy, variant: policy }, receipt });
    expect(request.mock.calls[0]![0]).toBe("/api/projects/p/interior-policies");
  });
  it("rejects unavailable and malformed responses without assumed fallback", async () => {
    const input = { comparisonId: "c", baseline: draft, variant: draft },
      signal = new AbortController().signal;
    await expect(
      fetchInteriorPolicies(
        "p",
        input,
        signal,
        async () => new Response("", { status: 503 }),
      ),
    ).rejects.toThrow(/No assumed run/);
    await expect(
      fetchInteriorPolicies("p", input, signal, async () =>
        Response.json({ policies: {} }),
      ),
    ).rejects.toThrow();
  });
});

it("requires server verification of a saved provider receipt without live generation", async () => {
  const input = {
    comparisonId: "c",
    baseline: draft,
    variant: draft,
    policies: { baseline: policy, variant: policy },
    receipt,
  };
  expect(
    await verifyInteriorPolicies("p", input, async () =>
      Response.json({ valid: true }),
    ),
  ).toBe(true);
  expect(
    await verifyInteriorPolicies("p", input, async () =>
      Response.json({ valid: false }),
    ),
  ).toBe(false);
  expect(
    await verifyInteriorPolicies(
      "p",
      input,
      async () => new Response("", { status: 503 }),
    ),
  ).toBe(false);
});
