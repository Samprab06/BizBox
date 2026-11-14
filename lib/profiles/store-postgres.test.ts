import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import * as schema from "@/lib/db/schema";
import { createPostgresProfileStore } from "./store-postgres";

vi.mock("server-only", () => ({}));
const enabled =
  process.env.RUN_ASSEMBLY_DB_TESTS === "1" &&
  !!process.env.HAC56_TEST_DATABASE_URL;

describe.skipIf(!enabled)("profile snapshots Postgres [local]", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let databaseName: string;
  let store: ReturnType<typeof createPostgresProfileStore>;
  const profile = syntheticHoustonFixture.profile;

  beforeAll(async () => {
    const url = new URL(process.env.HAC56_TEST_DATABASE_URL!);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/hac56_test_")
    )
      throw new Error(
        "Profile tests require a dedicated loopback hac56_test_ database",
      );
    admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
    databaseName = `hac56_test_profiles_${randomUUID().replaceAll("-", "")}`;
    await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
    url.pathname = `/${databaseName}`;
    // Multiple physical connections exercise the project lock rather than a
    // one-connection client accidentally serializing every save for us.
    client = postgres(url.toString(), { max: 4, connect_timeout: 5 });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(schema.projects).values([
      { id: profile.projectId, name: "Synthetic snapshot test" },
      { id: "other-project", name: "Separate project" },
    ]);
    store = createPostgresProfileStore(() => db);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      if (databaseName)
        await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end({ timeout: 5 });
    }
  });

  it("serializes concurrent versions and preserves old immutable snapshots", async () => {
    const snapshots = await Promise.all(
      Array.from({ length: 4 }, (_, n) =>
        store.saveSnapshot(profile.projectId, {
          ...profile,
          businessName: `Scenario ${n}`,
        }),
      ),
    );
    expect(snapshots.every(Boolean)).toBe(true);
    expect(snapshots.map((p) => p!.version).sort()).toEqual([1, 2, 3, 4]);
    expect(new Set(snapshots.map((p) => p!.id)).size).toBe(4);
    for (const snapshot of snapshots) {
      expect(snapshot!.id).not.toBe(profile.id);
      expect(await store.load(profile.projectId, snapshot!.id)).toEqual(
        snapshot,
      );
      expect(await store.load("other-project", snapshot!.id)).toBeNull();
    }
    const next = await store.saveSnapshot(profile.projectId, profile);
    expect(next?.version).toBe(5);
    expect(await store.load(profile.projectId, snapshots[0]!.id)).toEqual(
      snapshots[0],
    );
  });

  it("does not create projects and rejects invalid scope or corrupted snapshot identities", async () => {
    expect(
      await store.saveSnapshot("missing", { ...profile, projectId: "missing" }),
    ).toBeNull();
    await expect(store.saveSnapshot("other-project", profile)).rejects.toThrow(
      "project mismatch",
    );
    const db = drizzle(client, { schema });
    await db.insert(schema.profiles).values({
      id: "bad-snapshot",
      projectId: "other-project",
      version: 1,
      snapshot: { ...profile, id: "different-id", projectId: "other-project" },
    });
    await expect(store.load("other-project", "bad-snapshot")).rejects.toThrow(
      "identity mismatch",
    );
  });
});
