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
  it("reads many keys in one project- and model-scoped query", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => [
      { cache_key: "k1", response: value },
      { cache_key: "k3", response: { ...value, modelVersion: "" } }, // invalid rows are misses
    ]);
    const cache = createPostgresJevCache({ execute }, "project-a", "test-model");
    const hits = await cache.getMany!(["k1", "k2", "k3", "k1"]);
    expect([...hits.keys()]).toEqual(["k1"]);
    expect(hits.get("k1")).toEqual(value);
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(query.params).toEqual(["project-a", "test-model", "k1", "k2", "k3"]);
    expect(query.sql).toContain("cache_key IN (");
    expect(query.sql).toContain("expires_at>now()");
  });

  it("splits very large reads into chunks and makes no query for no keys", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => []);
    const cache = createPostgresJevCache({ execute }, "p", "m");
    await cache.getMany!([]);
    expect(execute).not.toHaveBeenCalled();
    await cache.getMany!(Array.from({ length: 4500 }, (_, i) => `k${i}`));
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("upserts many answers in one multi-row statement, keeping the last for a repeated key", async () => {
    const execute = vi.fn<(query: SQL) => Promise<unknown>>(async () => []);
    const cache = createPostgresJevCache({ execute }, "project-a", "jev-latest");
    const newer = { ...value, modelVersion: "jev-1.14.0" };
    await cache.setMany!([
      { key: "a", value },
      { key: "b", value },
      { key: "a", value: newer },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]!);
    expect(query.params.filter((_, i) => i % 5 === 1)).toEqual(["project-a", "project-a"]);
    expect(query.params.filter((_, i) => i % 5 === 2)).toEqual(["a", "b"]);
    expect(query.params.filter((_, i) => i % 5 === 4)).toEqual([JSON.stringify(newer), JSON.stringify(value)]);
    expect(query.sql).toContain("ON CONFLICT(project_id,cache_key)");
    await cache.setMany!([]);
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
