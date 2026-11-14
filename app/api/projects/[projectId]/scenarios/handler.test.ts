import { describe, expect, it, vi } from "vitest";
import { createScenarioHandlers } from "./handler";
import {
  ScenarioServiceError,
  type ScenarioService,
} from "@/lib/scenario/service";

vi.mock("server-only", () => ({}));

const context = { params: Promise.resolve({ projectId: "p1", id: "s1" }) };
const request = (data: unknown) =>
  new Request("http://local/api/projects/p1/scenarios", {
    method: "POST",
    body: JSON.stringify(data),
  });
const service = () => ({
  create: vi.fn(async () => ({ id: "s1" })),
  list: vi.fn(async () => []),
  get: vi.fn(async () => ({ id: "s1" })),
  diff: vi.fn(async () => ({ sites: { added: [], removed: [] } })),
  revert: vi.fn(async () => ({ id: "s2" })),
});

describe("scenario history HTTP boundary", () => {
  it("creates a scoped scenario and forbids shared caches", async () => {
    const dependency = service();
    const handlers = createScenarioHandlers(
      dependency as unknown as ScenarioService,
    );
    const response = await handlers.create(
      request({ label: "Baseline" }),
      context,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(dependency.create).toHaveBeenCalledWith("p1", { label: "Baseline" });
  });
  it("returns safe 404 and 503 responses without leaking storage errors", async () => {
    const dependency = service();
    dependency.get.mockRejectedValueOnce(
      new ScenarioServiceError("not_found", "private project internal details"),
    );
    dependency.list.mockRejectedValueOnce(
      new Error("postgres://user:secret@private-host/database"),
    );
    const handlers = createScenarioHandlers(
      dependency as unknown as ScenarioService,
    );
    expect(
      (await handlers.get(new Request("http://local/api"), context)).status,
    ).toBe(404);
    const unavailable = await handlers.list(
      new Request("http://local/api"),
      context,
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("secret");
  });
  it("validates project and body size before invoking the service", async () => {
    const dependency = service();
    const handlers = createScenarioHandlers(
      dependency as unknown as ScenarioService,
    );
    const invalid = await handlers.create(request({}), {
      params: Promise.resolve({ projectId: " " }),
    });
    expect(invalid.status).toBe(422);
    const huge = await handlers.create(
      request({ label: "x".repeat(70_000) }),
      context,
    );
    expect(huge.status).toBe(422);
    expect(dependency.create).not.toHaveBeenCalled();
  });
  it("rejects malformed bodies before a history mutation", async () => {
    const dependency = service();
    const handlers = createScenarioHandlers(
      dependency as unknown as ScenarioService,
    );
    const response = await handlers.create(
      new Request("http://local/api", { method: "POST", body: "{" }),
      context,
    );
    expect(response.status).toBe(422);
    expect(dependency.create).not.toHaveBeenCalled();
  });
  it("gets a scoped scenario diff when against is supplied", async () => {
    const dependency = service();
    const handlers = createScenarioHandlers(
      dependency as unknown as ScenarioService,
    );
    const response = await handlers.get(
      new Request("http://local/api?against=s2"),
      context,
    );
    expect(response.status).toBe(200);
    expect(dependency.diff).toHaveBeenCalledWith("p1", "s2", "s1");
    expect(await response.json()).toHaveProperty("diff");
  });
});
