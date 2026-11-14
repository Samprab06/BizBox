import { describe, expect, it, vi } from "vitest";
import { createScenarioRunHandlers } from "./run-handler";
import { ScenarioRunError } from "@/lib/scenario/run-store";
import type { ScenarioRunner } from "@/lib/scenario/run";
vi.mock("server-only", () => ({}));

const context = {
  params: Promise.resolve({ projectId: "p1", id: "s1", runId: "r1" }),
};
const post = (body?: unknown) =>
  new Request("http://local/api/run", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
function setup() {
  const start = vi.fn(async () => ({
    status: "needs_confirmation",
    costUnits: 180,
    remainingUnits: 100,
  }));
  const get = vi.fn(async () => ({ status: "running", runId: "r1" }));
  const advance = vi.fn(async () => ({ status: "running", runId: "r1" }));
  return {
    start,
    get,
    advance,
    handlers: createScenarioRunHandlers({
      start,
      get,
      advance,
    } as unknown as ScenarioRunner),
  };
}
describe("scenario run HTTP boundary", () => {
  it("returns the approved200 confirmation envelope without implying execution", async () => {
    const { handlers, start } = setup();
    const response = await handlers.start(post(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "needs_confirmation",
      costUnits: 180,
      remainingUnits: 100,
    });
    expect(start).toHaveBeenCalledWith("p1", "s1", {});
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("limits body bytes and rejects malformedJSON before invoking the runner", async () => {
    const { handlers, start } = setup();
    expect(
      (await handlers.start(post({ extra: "x".repeat(70000) }), context))
        .status,
    ).toBe(422);
    expect(
      (
        await handlers.start(
          new Request("http://local/api", { method: "POST", body: "{" }),
          context,
        )
      ).status,
    ).toBe(422);
    expect(start).not.toHaveBeenCalled();
  });
  it("scopes status/advance and rejects advance body mutations", async () => {
    const { handlers, get, advance } = setup();
    expect(
      (await handlers.get(new Request("http://local/api"), context)).status,
    ).toBe(200);
    expect(get).toHaveBeenCalledWith("p1", "s1", "r1");
    expect(
      (await handlers.advance(post({ confirm: true }), context)).status,
    ).toBe(422);
    expect(advance).not.toHaveBeenCalled();
    expect((await handlers.advance(post(), context)).status).toBe(202);
    expect(advance).toHaveBeenCalledWith("p1", "s1", "r1");
  });
  it("returns safe404/409/503 failures with no providercredentials", async () => {
    const { handlers, start } = setup();
    start.mockRejectedValueOnce(
      new ScenarioRunError("not_found", "private missing details"),
    );
    expect((await handlers.start(post(), context)).status).toBe(404);
    start.mockRejectedValueOnce(
      new ScenarioRunError("busy", "private lease details"),
    );
    expect((await handlers.start(post(), context)).status).toBe(409);
    start.mockRejectedValueOnce(new Error("postgres://user:secret@host/db"));
    const response = await handlers.start(post(), context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
