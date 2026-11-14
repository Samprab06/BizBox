import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  createPostgresThreadStore,
  type ThreadMutation,
  type ThreadStore,
} from "./thread-store";

vi.mock("server-only", () => ({}));

describe("thread store validation without database or models", () => {
  it("is lazy and validates negative/fractional costs before opening a connection", async () => {
    const database = vi.fn(() => {
      throw new Error("Unexpected database access");
    });
    const store = createPostgresThreadStore(database);
    expect(database).not.toHaveBeenCalled();
    await expect(store.ensure("p", -1)).rejects.toThrow();
    await expect(
      store.commit("p", 0, { idempotencyKey: "k", costMicrousd: 0.5 }),
    ).rejects.toThrow();
    await expect(
      store.commit("p", -1, { idempotencyKey: "k" }),
    ).rejects.toThrow();
    await expect(store.events("p", -1)).rejects.toThrow();
    expect(database).not.toHaveBeenCalled();
  });
  it("rejects non-JSON checkpoint values rather than silently losing resume data", async () => {
    const database = vi.fn(() => {
      throw new Error("Unexpected database access");
    });
    const store = createPostgresThreadStore(database);
    await expect(
      store.commit("p", 0, {
        idempotencyKey: "bad-json",
        checkpoint: { bad: Number.NaN },
      }),
    ).rejects.toThrow();
    expect(database).not.toHaveBeenCalled();
  });
});

const enabled =
  process.env.RUN_THREAD_DB_TESTS === "1" &&
  !!process.env.HAC83_TEST_DATABASE_URL;
describe.skipIf(!enabled)("durable Postgres consultant thread [local]", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let databaseName: string;
  let store: ThreadStore;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    const url = new URL(process.env.HAC83_TEST_DATABASE_URL!);
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^\/hac(?:83|96)_test/.test(url.pathname)
    ) {
      throw new Error(
        "Thread DB tests require a dedicated loopback hac83_test/hac96_test database",
      );
    }
    admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    databaseName = `hac83_test_${randomUUID().replaceAll("-", "")}`;
    await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
    url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(schema.projects).values([
      { id: "thread-p", name: "Synthetic consultant project" },
      { id: "thread-q", name: "Other synthetic project" },
    ]);
    store = createPostgresThreadStore(() => db);
  }, 30_000);
  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      if (databaseName)
        await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end({ timeout: 5 });
    }
  });

  it("creates exactly one thread concurrently, preserves its cap and isolates projects", async () => {
    expect(await store.load("missing")).toBeNull();
    await expect(store.ensure("missing")).rejects.toMatchObject({
      code: "not_found",
    });
    const results = await Promise.all([
      store.ensure("thread-p", 100),
      store.ensure("thread-p", 100),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await store.ensure("thread-p", 999)).toMatchObject({
      revision: 0,
      nextEventSeq: 1,
      costMicrousd: 0,
      costCapMicrousd: 100,
    });
    expect(await store.ensure("thread-q", 100)).toMatchObject({
      messages: [],
      checkpoint: null,
    });
    expect(await store.events("thread-q")).toEqual([]);
  });

  const mutation: ThreadMutation = {
    idempotencyKey: "turn-1:complete-tool-1",
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "Make this cheaper",
        turnId: "turn-1",
      },
    ],
    toolCalls: [
      {
        id: "tool-1",
        turnId: "turn-1",
        name: "lookup",
        input: { site: "s", project: "thread-p" },
        status: "completed",
        output: { found: true },
      },
    ],
    todos: [{ id: "todo-1", content: "Review proposal", status: "pending" }],
    turn: {
      id: "turn-1",
      status: "interrupted",
      toolCalls: 1,
      context: { siteId: "s" },
    },
    checkpoint: {
      nextStep: 2,
      proposals: [{ id: "pending-diff", status: "proposed" }],
    },
    events: [
      { type: "tool.completed", payload: { id: "tool-1" } },
      { type: "checkpoint", payload: null },
    ],
    costMicrousd: 30,
  };
  it("atomically reloads messages, completed tools, todos, pending cards, checkpoint and event cursor", async () => {
    const saved = await store.commit("thread-p", 0, mutation);
    expect(saved).toMatchObject({
      revision: 1,
      nextEventSeq: 3,
      costMicrousd: 30,
      messages: mutation.messages,
      toolCalls: mutation.toolCalls,
      todos: mutation.todos,
      turn: mutation.turn,
      checkpoint: mutation.checkpoint,
    });
    const reloaded = await createPostgresThreadStore(() => db).load("thread-p");
    expect(reloaded).toEqual(saved);
    expect(
      (await store.events("thread-p")).map(({ seq, payload }) => ({
        seq,
        payload,
      })),
    ).toEqual([
      { seq: 1, payload: { id: "tool-1" } },
      { seq: 2, payload: null },
    ]);
    expect(
      (await store.events("thread-p", 1)).map((event) => event.seq),
    ).toEqual([2]);
    expect((await store.load("thread-q"))?.costMicrousd).toBe(0);
  });

  it("replays stale concurrent commits without duplicate events, costs or completed tools", async () => {
    const reordered = {
      ...mutation,
      toolCalls: [
        {
          ...mutation.toolCalls![0],
          input: { project: "thread-p", site: "s" },
        },
      ],
    };
    const before = await store.load("thread-p");
    const results = await Promise.all([
      store.commit("thread-p", 0, mutation),
      store.commit("thread-p", 0, reordered),
    ]);
    expect(results[0]).toEqual(before);
    expect(results[1]).toEqual(before);
    expect(await store.events("thread-p")).toHaveLength(2);
    await expect(
      store.commit("thread-p", 0, { ...mutation, costMicrousd: 31 }),
    ).rejects.toMatchObject({ code: "replay_conflict" });
    await expect(
      store.commit("thread-p", 0, { idempotencyKey: "stale" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      store.commit("thread-p", 1, {
        idempotencyKey: "overwrite-tool",
        toolCalls: [{ ...mutation.toolCalls![0], status: "running" }],
      }),
    ).rejects.toMatchObject({ code: "tool_conflict" });
  });

  it("serializes distinct writers and prevents budget races with all-or-nothing receipts", async () => {
    const results = await Promise.allSettled([
      store.commit("thread-p", 1, {
        idempotencyKey: "race-a",
        costMicrousd: 50,
        events: [{ type: "cost", payload: "a" }],
      }),
      store.commit("thread-p", 1, {
        idempotencyKey: "race-b",
        costMicrousd: 50,
        events: [{ type: "cost", payload: "b" }],
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const before = await store.load("thread-p");
    expect(before).toMatchObject({
      revision: 2,
      costMicrousd: 80,
      nextEventSeq: 4,
    });
    await expect(
      store.commit("thread-p", 2, {
        idempotencyKey: "over-budget",
        costMicrousd: 21,
        events: [{ type: "should-not-save", payload: null }],
        checkpoint: null,
      }),
    ).rejects.toMatchObject({ code: "cost_limit" });
    expect(await store.load("thread-p")).toEqual(before);
    expect(await store.events("thread-p")).toHaveLength(3);
    // Failed mutations leave no receipt behind; reuse the key within budget.
    expect(
      await store.commit("thread-p", 2, {
        idempotencyKey: "over-budget",
        costMicrousd: 20,
      }),
    ).toMatchObject({ costMicrousd: 100, revision: 3 });
    expect(
      await store.commit("thread-p", 3, {
        idempotencyKey: "finish-at-cap",
        turn: {
          id: "turn-1",
          status: "limited",
          reason: "Project cost cap reached",
        },
      }),
    ).toMatchObject({ costMicrousd: 100, revision: 4 });
  });

  it("rolls back state, event sequence, cost and receipt together after an insertion failure", async () => {
    await client`CREATE FUNCTION reject_thread_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'reject-test' THEN RAISE EXCEPTION 'synthetic event failure'; END IF; RETURN NEW; END $$`;
    await client`CREATE TRIGGER reject_thread_event BEFORE INSERT ON copilot_thread_events FOR EACH ROW EXECUTE FUNCTION reject_thread_event()`;
    const before = await store.load("thread-q");
    await expect(
      store.commit("thread-q", 0, {
        idempotencyKey: "rollback",
        costMicrousd: 10,
        checkpoint: { test: true },
        events: [
          { type: "good", payload: null },
          { type: "reject-test", payload: null },
        ],
      }),
    ).rejects.toThrow();
    expect(await store.load("thread-q")).toEqual(before);
    expect(await store.events("thread-q")).toEqual([]);
    expect(
      await store.commit("thread-q", 0, {
        idempotencyKey: "rollback",
        costMicrousd: 10,
        events: [{ type: "good", payload: null }],
      }),
    ).toMatchObject({ revision: 1, nextEventSeq: 2, costMicrousd: 10 });
  });
});
