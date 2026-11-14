import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createRootScenario } from "./model";
import { createPostgresScenarioRepository } from "./repository";
import { createPostgresScenarioExecutionStore } from "./run-store-postgres";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_SCENARIO_EXECUTION_DB_TESTS === "1" &&
  !!process.env.SCENARIO_EXECUTION_TEST_DATABASE_URL;
describe.skipIf(!enabled)(
  "scenario reservation and checkpoint storage [disposable local PostgreSQL]",
  () => {
    let admin: ReturnType<typeof postgres>,
      client: ReturnType<typeof postgres>,
      databaseName: string;
    let databaseCreated = false;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let executions: ReturnType<typeof createPostgresScenarioExecutionStore>;
    const now = new Date("2026-11-14T17:00:00.000Z");
    beforeAll(async () => {
      const url = new URL(process.env.SCENARIO_EXECUTION_TEST_DATABASE_URL!);
      if (!["localhost", "127.0.0.1"].includes(url.hostname))
        throw new Error("Execution DB tests require loopback");
      admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
      databaseName = `hac81_test_${randomUUID().replaceAll("-", "")}`;
      await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
      databaseCreated = true;
      url.pathname = `/${databaseName}`;
      client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
      db = drizzle(client, { schema });
      await migrate(db, { migrationsFolder: "drizzle" });
      await migrate(db, { migrationsFolder: "drizzle" });
      executions = createPostgresScenarioExecutionStore(() => db);
    }, 30_000);
    afterAll(async () => {
      if (client) await client.end({ timeout: 5 });
      if (admin) {
        try {
          if (databaseCreated)
            await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
        } finally {
          await admin.end({ timeout: 5 });
        }
      }
    });
    async function seed() {
      const projectId = `p_${randomUUID()}`,
        scenarioId = `s_${randomUUID()}`;
      await db
        .insert(schema.projects)
        .values({ id: projectId, name: "Synthetic execution test" });
      const profile = {
        ...syntheticHoustonFixture.profile,
        projectId,
        id: `profile_${randomUUID()}`,
      };
      await db
        .insert(schema.profiles)
        .values({ id: profile.id, projectId, version: 1, snapshot: profile });
      await createPostgresScenarioRepository(() => db).insert(
        createRootScenario({
          id: scenarioId,
          projectId,
          siteIds: ["site-a"],
          profileVersion: 1,
          label: "Test",
          author: "founder",
          createdAt: now.toISOString(),
        }),
      );
      return { projectId, scenarioId };
    }
    function input(
      scope: { projectId: string; scenarioId: string },
      name: string,
      extra = {},
    ) {
      return {
        ...scope,
        id: `run_${randomUUID()}`,
        idempotencyKey: name,
        effectiveKey: name,
        costUnits: 8,
        budgetUnits: 8,
        confirm: false,
        now,
        ...extra,
      };
    }
    it("serializes concurrent project reservations and leaves rejected requests unwritten", async () => {
      const scope = await seed();
      const values = await Promise.all([
        executions.reserve(input(scope, "a")),
        executions.reserve(input(scope, "b")),
      ]);
      expect(values.filter((v) => v.status === "reserved")).toHaveLength(1);
      expect(
        values.filter((v) => v.status === "needs_confirmation"),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.scenarioRuns)
          .where(eq(schema.scenarioRuns.projectId, scope.projectId)),
      ).toHaveLength(1);
    });
    it("deduplicates idempotency keys and counts explicit confirmations over the rolling window", async () => {
      const scope = await seed();
      const first = input(scope, "one");
      const a = await executions.reserve(first),
        again = await executions.reserve({ ...first, id: "unused-id" });
      expect(again).toEqual(a);
      expect(await executions.reserve(input(scope, "two"))).toMatchObject({
        status: "needs_confirmation",
        remainingUnits: 0,
      });
      expect(
        await executions.reserve(input(scope, "two", { confirm: true })),
      ).toMatchObject({ status: "reserved", execution: { costUnits: 8 } });
      expect(
        await executions.reserve(
          input(scope, "tomorrow", {
            now: new Date(now.getTime() + 25 * 60 * 60_000),
          }),
        ),
      ).toMatchObject({ status: "reserved" });
    });
    it("fences revisions, active leases, expired owners and stale release attempts", async () => {
      const scope = await seed();
      const reserved = await executions.reserve(input(scope, "lease"));
      if (reserved.status !== "reserved")
        throw new Error("Expected reservation");
      const id = reserved.execution.id;
      const leased = await executions.acquire(
        scope.projectId,
        id,
        "owner-a",
        now,
        1000,
      );
      expect(leased).not.toBeNull();
      expect(
        await executions.acquire(scope.projectId, id, "owner-b", now, 1000),
      ).toBeNull();
      const saved = await executions.save(
        { ...leased!, status: "running" },
        "owner-a",
        now,
      );
      expect(saved.revision).toBe(1);
      await expect(
        executions.save(leased!, "owner-a", now),
      ).rejects.toMatchObject({ code: "lease_lost" });
      const later = new Date(now.getTime() + 1001);
      expect(
        await executions.acquire(scope.projectId, id, "owner-b", later, 1000),
      ).not.toBeNull();
      await executions.release(scope.projectId, id, "owner-a");
      expect(
        await executions.acquire(scope.projectId, id, "owner-c", later, 1000),
      ).toBeNull();
      await expect(
        executions.save(saved, "owner-a", later),
      ).rejects.toMatchObject({ code: "lease_lost" });
    });
    it("scopes all reads and lease operations to the project", async () => {
      const a = await seed(),
        b = await seed();
      const result = await executions.reserve(input(a, "scope"));
      if (result.status !== "reserved") throw new Error("Expected reservation");
      expect(await executions.get(b.projectId, result.execution.id)).toBeNull();
      expect(
        await executions.acquire(
          b.projectId,
          result.execution.id,
          "wrong",
          now,
          1000,
        ),
      ).toBeNull();
      await expect(
        executions.reserve(
          input(
            { projectId: b.projectId, scenarioId: a.scenarioId },
            "bad-scenario",
          ),
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  },
);
