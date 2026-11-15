import { it, expect, vi } from "vitest";
import type { InteriorPolicyInput } from "@/lib/interior/policies";
import { createSpatialDraft } from "@/lib/spatial";
import { createInteriorPoliciesHandler } from "./handler";
it("passes cancellation to preparation and sanitizes persistence errors", async () => {
  const work = vi.fn<
      (input: InteriorPolicyInput, signal?: AbortSignal) => Promise<unknown>
    >(async () => {
      throw new Error("postgres://private-secret");
    }),
    draft = createSpatialDraft({
      projectId: "p",
      siteId: "s",
      city: "houston",
    }),
    controller = new AbortController();
  const request = new Request("http://localhost/api", {
    method: "POST",
    signal: controller.signal,
    body: JSON.stringify({
      comparisonId: "c",
      baseline: draft,
      variant: draft,
    }),
  });
  const result = await createInteriorPoliciesHandler(work)(request, {
    params: Promise.resolve({ projectId: "p" }),
  });
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("private-secret");
  expect(work.mock.calls[0]![1]).toBe(request.signal);
});
it("rejects arbitrary metric payloads without executing preparation", async () => {
  const work = vi.fn();
  const response = await createInteriorPoliciesHandler(work)(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ policies: { source: "jev" } }),
    }),
    { params: Promise.resolve({ projectId: "p" }) },
  );
  expect(response.status).toBe(422);
  expect(work).not.toHaveBeenCalled();
});
