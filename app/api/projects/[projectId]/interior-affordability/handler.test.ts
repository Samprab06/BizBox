import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInteriorAffordabilityHandler } from "./handler";
import { createSpatialDraft } from "@/lib/spatial";
import { InteriorAffordabilityError } from "@/lib/nessie/interior-assessment";
const baseline = createSpatialDraft({
  projectId: "p",
  siteId: "s",
  city: "houston",
});
const input = {
  comparisonId: "c",
  siteId: "s",
  baseline,
  draft: baseline,
  ranRevision: 0,
  reviewedRevision: 0,
};
const request = (body: unknown) =>
  new Request("http://localhost/api/projects/p/interior-affordability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
it("passes only validated scoped input and cancellation signal to the read-only service", async () => {
  const work = vi.fn(async () => ({ status: "unconfigured" }));
  const req = request(input),
    response = await createInteriorAffordabilityHandler(work)(req, {
      params: Promise.resolve({ projectId: "p" }),
    });
  expect(response.status).toBe(200);
  expect(work).toHaveBeenCalledWith("p", input, req.signal);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("refuses model-authored money and returns safe scope/unavailable errors", async () => {
  const work = vi.fn(async () => ({}));
  const handler = createInteriorAffordabilityHandler(work);
  expect(
    (
      await handler(request({ ...input, availableCents: 100000 }), {
        params: Promise.resolve({ projectId: "p" }),
      })
    ).status,
  ).toBe(422);
  expect(work).not.toHaveBeenCalled();
  const denied = createInteriorAffordabilityHandler(async () => {
    throw new InteriorAffordabilityError("scope", "Selected site not found");
  });
  expect(
    (
      await denied(request(input), {
        params: Promise.resolve({ projectId: "p" }),
      })
    ).status,
  ).toBe(404);
  const failed = createInteriorAffordabilityHandler(async () => {
    throw new Error("secret database details");
  });
  const response = await failed(request(input), {
    params: Promise.resolve({ projectId: "p" }),
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
});
