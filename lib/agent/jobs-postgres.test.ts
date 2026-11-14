import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createPostgresInvestigationRepository } from "./jobs-postgres";
import { createInvestigationService } from "./jobs";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_JOB_DB_TESTS === "1" && !!process.env.HAC52_TEST_DATABASE_URL;

describe.skipIf(!enabled)("investigation Postgres adapter [local]", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let directory: string;
  let databaseName: string;
  let repository: ReturnType<typeof createPostgresInvestigationRepository>;
  const profile = syntheticHoustonFixture.profile;
  const input = {
    projectId: profile.projectId,
    profileId: profile.id,
    question: "Synthetic job test",
  };

  beforeAll(async () => {
    const url = new URL(process.env.HAC52_TEST_DATABASE_URL!);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/hac52_test_")
    )
      throw new Error(
        "Job DB tests require a dedicated loopback hac52_test_ database",
      );
    admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    databaseName = `hac52_test_${randomUUID().replaceAll("-", "")}`;
    await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
    url.pathname = `/${databaseName}`;
    client = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    const db = drizzle(client, { schema });
    directory = await mkdtemp(join(tmpdir(), "hac52-migrations-"));
    await mkdir(join(directory, "meta"));
    const journal = JSON.parse(
      await readFile("drizzle/meta/_journal.json", "utf8"),
    );
    await copyFile(
      "drizzle/0000_platform.sql",
      join(directory, "0000_platform.sql"),
    );
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
    );
    await migrate(db, { migrationsFolder: directory });
    await db
      .insert(schema.projects)
      .values({ id: profile.projectId, name: "Synthetic database project" });
    await db
      .insert(schema.profiles)
      .values({
        id: profile.id,
        projectId: profile.projectId,
        version: 1,
        snapshot: profile,
      });
    await client`INSERT INTO investigations (id,project_id,profile_id,question,status) VALUES ('legacy-completed',${profile.projectId},${profile.id},'Legacy synthetic job','completed')`;
    await migrate(db, { migrationsFolder: "drizzle" });
    repository = createPostgresInvestigationRepository(() => db);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      if (databaseName)
        await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end({ timeout: 5 });
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("upgrades completed rows without data loss and safely reruns migrations", async () => {
    expect(await repository.load("legacy-completed")).toMatchObject({
      status: "succeeded",
      question: "Legacy synthetic job",
      attempt: 1,
      revision: 0,
    });
    await migrate(drizzle(client, { schema }), { migrationsFolder: "drizzle" });
    expect((await repository.load("legacy-completed"))?.status).toBe(
      "succeeded",
    );
  });

  it("durably resumes completed steps and stores JSON null without SQL NULL", async () => {
    const service = createInvestigationService(repository);
    const job = await service.create(input);
    const execute = vi.fn(async () => ({
      summary: null,
      findings: ["Useful synthetic finding"],
      done: true,
    }));
    const result = await service.advance(job.id, async () => ({
      tool: "inspect",
      inputHash: "hash",
      execute,
    }));
    expect(result.status).toBe("succeeded");
    const resumed = createInvestigationService(
      createPostgresInvestigationRepository(() => drizzle(client, { schema })),
    );
    const never = vi.fn(async () => null);
    expect((await resumed.advance(job.id, never)).status).toBe("succeeded");
    expect(never).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await repository.listMilestones(job.id)).toMatchObject([
      { summary: null, seq: 0 },
    ]);
    const [row] =
      await client`SELECT summary IS NULL AS sql_null FROM investigation_milestones WHERE investigation_id=${job.id}`;
    expect(row.sql_null).toBe(false);
  });

  it("fences concurrent/expired owners and rolls duplicate milestones back atomically", async () => {
    const service = createInvestigationService(repository);
    const job = await service.create(input);
    const owned = (await repository.acquire(
      job.id,
      "owner-a",
      new Date(),
      30_000,
    ))!;
    expect(
      await repository.acquire(job.id, "owner-b", new Date(), 30_000),
    ).toBeNull();
    const milestone = {
      investigationId: job.id,
      attempt: 1,
      seq: 0,
      tool: "inspect",
      inputHash: "hash",
      summary: { ok: true },
      createdAt: new Date().toISOString(),
    };
    const stored = await repository.save(
      { ...owned, counters: { ...owned.counters, toolCalls: 1 } },
      "owner-a",
      milestone,
    );
    await expect(
      repository.save(
        { ...stored, findings: ["Must roll back"] },
        "owner-a",
        milestone,
      ),
    ).rejects.toThrow();
    expect((await repository.load(job.id))?.revision).toBe(stored.revision);
    expect((await repository.load(job.id))?.findings).toEqual([]);
    await client`UPDATE investigations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${job.id}`;
    await expect(repository.save(stored, "owner-a")).rejects.toMatchObject({
      code: "lease_lost",
    });
    const next = (await repository.acquire(
      job.id,
      "owner-b",
      new Date(),
      30_000,
    ))!;
    await repository.release(job.id, "owner-a");
    expect(
      await repository.acquire(job.id, "owner-c", new Date(), 30_000),
    ).toBeNull();
    await repository.save(next, "owner-b");
    await repository.release(job.id, "owner-b");
  });

  it("persists retry attempts and rejects profiles outside the project", async () => {
    const service = createInvestigationService(repository);
    const job = await service.create(input);
    await service.markInterrupted(job.id);
    expect((await service.retry(job.id)).attempt).toBe(2);
    await expect(
      service.create({ ...input, profileId: "not-in-this-project" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
