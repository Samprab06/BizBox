import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createRootScenario } from "./model";
import { createScenarioService } from "./service";
import {
  createPostgresScenarioRepository,
  ScenarioRepositoryError,
  type ScenarioRepository,
} from "./repository";

vi.mock("server-only", () => ({}));

describe("scenario repository source", () => {
  const source = readFileSync("lib/scenario/repository.ts", "utf8");
  it("never updates or deletes the scenarios table", () => {
    expect(source).not.toMatch(/\.update\(\s*scenarios\s*\)/);
    expect(source).not.toMatch(/\.delete\(\s*scenarios\s*\)/);
    const names =
      source.match(/^\s{4}async (\w+)\(/gm)?.map((m) => m.trim()) ?? [];
    expect(
      names.filter((n) =>
        /async (update|edit|patch|set)\w*Scenario\b/i.test(n),
      ),
    ).toEqual([]);
  });
});

const enabled =
  process.env.RUN_SCENARIO_DB_TESTS === "1" &&
  !!process.env.SCENARIO_TEST_DATABASE_URL;

describe.skipIf(!enabled)("scenario Postgres adapter [local]", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let databaseName: string;
  let repository: ScenarioRepository;
  const profile = syntheticHoustonFixture.profile;
  const projectId = profile.projectId;
  const at = (day: number) => `2026-02-0${day}T00:00:00.000Z`;
  const rootInput = {
    id: "sc-1",
    projectId,
    siteIds: ["site-a", "site-b"],
    profileVersion: 1,
    label: "Base",
    author: "founder" as const,
    createdAt: at(1),
  };

  beforeAll(async () => {
    const url = new URL(process.env.SCENARIO_TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Scenario DB tests require a loopback database");
    admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    databaseName = `hac80_test_${randomUUID().replaceAll("-", "")}`;
    await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
    url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(schema.projects)
      .values({ id: projectId, name: "Synthetic scenario project" });
    await db.insert(schema.profiles).values({
      id: profile.id,
      projectId,
      version: 1,
      snapshot: profile,
    });
    repository = createPostgresScenarioRepository(() => db);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      if (databaseName)
        await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end({ timeout: 5 });
    }
  });

  it("stores a root and versions that point at their parent", async () => {
    const root = await repository.insert(createRootScenario(rootInput));
    expect(root).toEqual(createRootScenario(rootInput));
    const child = await repository.appendVersion(
      projectId,
      "sc-1",
      { label: "Later close" },
      {
        id: "sc-2",
        createdAt: at(2),
        author: "agent",
        rationale: "Probe closing time",
      },
    );
    expect(child.parentId).toBe("sc-1");
    expect((await repository.get(projectId, "sc-1"))?.label).toBe("Base");
    expect(
      (await repository.lineage(projectId, "sc-2")).map((s) => s.id),
    ).toEqual(["sc-1", "sc-2"]);
    expect((await repository.list(projectId)).map((s) => s.id)).toEqual([
      "sc-1",
      "sc-2",
    ]);
  });

  it("rejects any in-place UPDATE at the database", async () => {
    await expect(
      client`UPDATE scenarios SET label = 'changed' WHERE id = 'sc-1'`,
    ).rejects.toThrow(/immutable/);
    await expect(
      client`UPDATE scenarios SET parent_id = NULL WHERE id = 'sc-2'`,
    ).rejects.toThrow(/immutable/);
    expect((await repository.get(projectId, "sc-1"))?.label).toBe("Base");
  });

  it("enforces scoping and the author rules in the database", async () => {
    await expect(
      repository.insert(
        createRootScenario({ ...rootInput, id: "sc-bad", profileVersion: 9 }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      repository.insert(createRootScenario({ ...rootInput })),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repository.appendVersion(
        projectId,
        "missing",
        {},
        { id: "sc-9", createdAt: at(3), author: "founder" },
      ),
    ).rejects.toBeInstanceOf(ScenarioRepositoryError);
    await expect(
      client`INSERT INTO scenarios (id, project_id, site_ids, profile_version, overrides, label, author)
             VALUES ('raw-1', ${projectId}, '["a"]', 1, '{}', 'x', 'agent')`,
    ).rejects.toThrow(/scenarios_agent_rationale/);
    await expect(
      client`INSERT INTO scenarios (id, project_id, site_ids, profile_version, overrides, label, author, rationale)
             VALUES ('raw-2', ${projectId}, '["a"]', 1,
               '{"staffHeadcount":{"value":2,"unit":"people","origin":"founder","evidenceIds":["e"]}}', 'x', 'agent', 'why')`,
    ).rejects.toThrow(/scenarios_agent_never_founder/);
    await expect(
      client`INSERT INTO scenarios (id, project_id, site_ids, profile_version, overrides, label, author)
             VALUES ('raw-3', ${projectId}, '[]', 1, '{}', 'x', 'founder')`,
    ).rejects.toThrow(/scenarios_site_ids_valid/);
  });

  it("tracks runs and the active scenario per project", async () => {
    await client`INSERT INTO comparisons (id, project_id, profile_id, data) VALUES ('cmp-1', ${projectId}, ${profile.id}, '{}')`;
    const run = await repository.createRun({
      id: "run-1",
      projectId,
      scenarioId: "sc-2",
      now: new Date(at(3)),
    });
    expect(run).toMatchObject({
      status: "queued",
      comparisonId: null,
      runIds: [],
    });
    const done = await repository.updateRun(projectId, "run-1", {
      status: "succeeded",
      comparisonId: "cmp-1",
      runIds: ["sr-1", "sr-2"],
      now: new Date(at(4)),
    });
    expect(done).toMatchObject({
      status: "succeeded",
      comparisonId: "cmp-1",
      runIds: ["sr-1", "sr-2"],
    });
    expect(await repository.listRuns(projectId, "sc-2")).toHaveLength(1);
    await expect(
      repository.createRun({
        id: "run-x",
        projectId,
        scenarioId: "nope",
        now: new Date(at(3)),
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    expect(await repository.getActive(projectId)).toBeNull();
    await repository.setActive(projectId, "sc-1", new Date(at(3)));
    const active = await repository.setActive(
      projectId,
      "sc-2",
      new Date(at(4)),
    );
    expect(active.scenarioId).toBe("sc-2");
    expect((await repository.getActive(projectId))?.scenarioId).toBe("sc-2");
    await expect(
      repository.setActive(projectId, "nope", new Date(at(4))),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("allows inherited founder wrappers but rejects forged founder children at the database", async () => {
    const overrides = {
      staffHeadcount: {
        value: 2,
        unit: "people",
        origin: "founder" as const,
        evidenceIds: ["founder-answer"],
      },
    };
    await repository.insert(
      createRootScenario({ ...rootInput, id: "founder-parent", overrides }),
    );
    const child = await repository.appendVersion(
      projectId,
      "founder-parent",
      { label: "Proposal" },
      {
        id: "inherited-child",
        createdAt: at(4),
        author: "agent",
        rationale: "Preserve supplied staff",
      },
    );
    expect(child.overrides).toEqual(overrides);
    await expect(client`INSERT INTO scenarios (id,project_id,parent_id,site_ids,profile_version,overrides,label,author,rationale)
      VALUES ('forged-child',${projectId},'founder-parent','["site-a","site-b"]',1,
      '{"staffHeadcount":{"value":3,"unit":"people","origin":"founder","evidenceIds":["founder-answer"]}}','x','agent','why')`).rejects.toThrow(
      /Agent cannot introduce or change founder provenance/,
    );
    await expect(client`INSERT INTO scenarios (id,project_id,parent_id,site_ids,profile_version,overrides,label,author,rationale)
      VALUES ('invented-child',${projectId},'sc-1','["site-a","site-b"]',1,
      '{"staffHeadcount":{"value":2,"unit":"people","origin":"founder","evidenceIds":["founder-answer"]}}','x','agent','why')`).rejects.toThrow(
      /Agent cannot introduce or change founder provenance/,
    );
  });

  it("recovers concurrent durable action retries through mapped Postgres conflicts", async () => {
    const one = createScenarioService({ repository, newId: randomUUID });
    const two = createScenarioService({ repository, newId: randomUUID });
    const request = {
      fromId: "sc-1",
      patch: { label: "One accepted action" },
      author: "agent",
      rationale: "Retry safely",
    };
    const [a, b] = await Promise.all([
      one.create(projectId, request, { idempotencyKey: "durable-action" }),
      two.create(projectId, request, { idempotencyKey: "durable-action" }),
    ]);
    expect(a).toEqual(b);
    expect(
      (await repository.list(projectId)).filter((row) => row.id === a.id),
    ).toHaveLength(1);
    const restarted = createScenarioService({ repository, newId: randomUUID });
    expect(
      await restarted.create(projectId, request, {
        idempotencyKey: "durable-action",
      }),
    ).toEqual(a);
    await expect(
      restarted.create(
        projectId,
        { ...request, patch: { label: "Different action" } },
        { idempotencyKey: "durable-action" },
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
