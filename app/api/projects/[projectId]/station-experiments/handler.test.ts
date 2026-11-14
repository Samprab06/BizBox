import { expect, it, vi } from "vitest";
import { createStationExperimentHandlers } from "./handler";
const context = { params: Promise.resolve({ projectId: "p" }) };
const service = {
  get: vi.fn(async () => ({ status: "planned" })),
  post: vi.fn(async () => ({ status: "running" })),
};
it("GET is read-only, validates query, and keeps responses private", async () => {
  const h = createStationExperimentHandlers(service as never);
  const result = await h.GET(
    new Request("http://local/api?comparisonId=c&siteId=s"),
    context,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(service.post).not.toHaveBeenCalled();
  expect(
    (
      await h.GET(
        new Request("http://local/api?comparisonId=c&siteId=s&confirm=true"),
        context,
      )
    ).status,
  ).toBe(422);
});
it("bounds POST input and returns safe failure statuses without leaking internals", async () => {
  const h = createStationExperimentHandlers(service as never);
  const request = (body: string) =>
    new Request("http://local/api", { method: "POST", body });
  expect(
    (
      await h.POST(
        request(
          JSON.stringify({
            comparisonId: "c",
            siteId: "s",
            configurationId: "baseline",
          }),
        ),
        context,
      )
    ).status,
  ).toBe(202);
  expect((await h.POST(request("x".repeat(32769)), context)).status).toBe(422);
  expect((await h.POST(request('{"confirm":"yes"}'), context)).status).toBe(
    422,
  );
  service.get.mockRejectedValueOnce(new Error("secret database details"));
  const failure = await h.GET(
    new Request("http://local/api?comparisonId=c&siteId=s"),
    context,
  );
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain("secret");
});

it("maps project-scoped misses and ownership conflicts safely", async () => {
  const { ScenarioRunError } = await import("@/lib/scenario/run-store");
  const h = createStationExperimentHandlers(service as never);
  service.get.mockRejectedValueOnce(
    new ScenarioRunError("not_found", "internal source details"),
  );
  const missing = await h.GET(
    new Request("http://local/api?comparisonId=c&siteId=s"),
    context,
  );
  expect(missing.status).toBe(404);
  expect(await missing.text()).not.toContain("internal");
  service.get.mockRejectedValueOnce(
    new ScenarioRunError("busy", "lease internals"),
  );
  expect(
    (
      await h.GET(
        new Request("http://local/api?comparisonId=c&siteId=s"),
        context,
      )
    ).status,
  ).toBe(409);
});
