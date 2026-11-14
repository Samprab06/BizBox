import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createPostgresJevCache } from "./cache-postgres";

const value = {
  modelVersion: "test-model",
  answers: {
    where: { probabilities: { site_a: 0.8, none: 0.2 }, confidence: 0.7 },
  },
};
describe("Postgres Jev cache boundary", () => {
  it("scopes reads by project, model, request key and expiry", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => [
      { response: value },
    ]);
    const cache = createPostgresJevCache(
      { execute },
      "project-a",
      "test-model",
    );
    expect(await cache.get("sha-key")).toEqual(value);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(query.params).toEqual(["project-a", "sha-key", "test-model"]);
    expect(query.sql).toContain("expires_at>now()");
  });
  it("rejects invalid cached probabilities and missing resolved model identity", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ response: { ...value, modelVersion: "" } }])
      .mockResolvedValueOnce([
        {
          response: {
            ...value,
            answers: { where: { probabilities: { site: 2 }, confidence: 0.7 } },
          },
        },
      ]);
    const cache = createPostgresJevCache(
      { execute },
      "project-a",
      "test-model",
    );
    expect(await cache.get("x")).toBeUndefined();
    expect(await cache.get("x")).toBeUndefined();
  });
  it("upserts exact normalized answers under the configured request model", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => []);
    const cache = createPostgresJevCache(
      { execute },
      "project-a",
      "test-model",
    );
    await cache.set("key", value);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(query.params.slice(1)).toEqual([
      "project-a",
      "key",
      "test-model",
      JSON.stringify(value),
    ]);
    expect(query.sql).toContain("ON CONFLICT(project_id,cache_key)");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("keeps a resolved response version while indexing by the requested alias", async () => {
    const resolved = { ...value, modelVersion: "jev-1.14.0" };
    const execute = vi
      .fn<(query: SQL) => Promise<unknown>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ response: resolved }]);
    const cache = createPostgresJevCache(
      { execute },
      "project-a",
      "jev-latest",
    );
    await cache.set("request-sha", resolved);
    const write = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(write.params.slice(1)).toEqual([
      "project-a",
      "request-sha",
      "jev-latest",
      JSON.stringify(resolved),
    ]);
    expect(await cache.get("request-sha")).toEqual(resolved);
    const read = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]!);
    expect(read.params).toEqual(["project-a", "request-sha", "jev-latest"]);
  });
});
