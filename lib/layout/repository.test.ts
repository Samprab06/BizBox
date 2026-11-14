import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { createRootScenario } from "@/lib/scenario/model";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { applyLayoutOp, LayoutInputError } from "./model";
import { layoutFixture } from "./layout.fixture";
import {
  createPostgresLayoutRepository,
  loadLayoutDiffHook,
  type LayoutRepository,
} from "./repository";

vi.mock("server-only", () => ({}));

it("validates geometry and exact scope before opening a database", async () => {
  const repo = createPostgresLayoutRepository(() => {
    throw new Error("database must remain unopened");
  });
  const layout = layoutFixture();
  const bad = {
    ...layout,
    stations: [
      { ...layout.stations[0], footprint: { ...layout.counter.footprint } },
    ],
  };
  await expect(repo.insert("project", bad)).rejects.toBeInstanceOf(
    LayoutInputError,
  );
  await expect(repo.get("", layout.layoutId)).rejects.toBeInstanceOf(
    LayoutInputError,
  );
  await expect(repo.get(" project ", layout.layoutId)).rejects.toBeInstanceOf(
    LayoutInputError,
  );
  await expect(
    repo.get("project", ` ${layout.layoutId}`),
  ).rejects.toBeInstanceOf(LayoutInputError);
});

const enabled =
  process.env.RUN_LAYOUT_DB_TESTS === "1" &&
  !!process.env.LAYOUT_TEST_DATABASE_URL;
describe.skipIf(!enabled)(
  "layout repository and FKs [disposable local Postgres]",
  () => {
    let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>;
    let databaseName: string, repository: LayoutRepository;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    const projectA = "layout-project-a",
      projectB = "layout-project-b";
    const root = layoutFixture("layout-a", "site-a");
    beforeAll(async () => {
      const url = new URL(process.env.LAYOUT_TEST_DATABASE_URL!);
      if (!["localhost", "127.0.0.1"].includes(url.hostname))
        throw new Error("Layout tests require a loopback database");
      admin = postgres(url.toString(), { max: 1, connect_timeout: 5 });
      databaseName = `hac86_test_${randomUUID().replaceAll("-", "")}`;
      await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
      url.pathname = `/${databaseName}`;
      client = postgres(url.toString(), { max: 1, connect_timeout: 5 });
      db = drizzle(client, { schema });
      await migrate(db, { migrationsFolder: "drizzle" });
      await db.insert(schema.projects).values([
        { id: projectA, name: "Layout A" },
        { id: projectB, name: "Layout B" },
      ]);
      for (const projectId of [projectA, projectB]) {
        await db.insert(schema.profiles).values({
          id: `profile-${projectId}`,
          projectId,
          version: 1,
          snapshot: {
            ...syntheticHoustonFixture.profile,
            id: `profile-${projectId}`,
            projectId,
          },
        });
      }
      repository = createPostgresLayoutRepository(() => db);
    }, 30_000);
    afterAll(async () => {
      if (client) await client.end({ timeout: 5 });
      if (admin) {
        if (databaseName)
          await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
        await admin.end({ timeout: 5 });
      }
    });
    it("round-trips frozen roots and child versions and hides other projects", async () => {
      expect(await repository.insert(projectA, root)).toEqual(root);
      const child = applyLayoutOp(
        root,
        { op: "remove", elementId: "seat1" },
        { layoutId: "layout-child" },
      );
      expect(await repository.insert(projectA, child)).toEqual(child);
      expect((await repository.get(projectA, child.layoutId))?.parentId).toBe(
        root.layoutId,
      );
      expect(
        Object.isFrozen(
          (await repository.get(projectA, root.layoutId))?.stations[0]
            .footprint,
        ),
      ).toBe(true);
      expect(await repository.get(projectB, root.layoutId)).toBeNull();
      expect(await repository.get(projectA, "missing")).toBeNull();
    });
    it("rejects globally reused IDs, cross-project parents and cross-site parents", async () => {
      await expect(repository.insert(projectA, root)).rejects.toMatchObject({
        code: "conflict",
      });
      await expect(repository.insert(projectB, root)).rejects.toMatchObject({
        code: "conflict",
      });
      const child = applyLayoutOp(
        root,
        { op: "remove", elementId: "seat1" },
        { layoutId: "layout-forged" },
      );
      await expect(repository.insert(projectB, child)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        repository.insert(projectA, { ...child, siteId: "site-b" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("preloads a project-scoped synchronous layout diff and rejects unresolved IDs", async () => {
      const hook = await loadLayoutDiffHook(repository, projectA, [
        root.layoutId,
        "layout-child",
        null,
      ]);
      expect(hook.summarize(root.layoutId, "layout-child")).toMatchObject({
        changedElementIds: ["seat1"],
      });
      await expect(
        loadLayoutDiffHook(repository, projectB, [root.layoutId]),
      ).rejects.toBeInstanceOf(LayoutInputError);
    });
    it("rejects in-place updates and JSON/scalar identity mismatches at the database", async () => {
      await expect(
        client`UPDATE layouts SET data = jsonb_set(data, '{category}', '"fitness"') WHERE id = ${root.layoutId}`,
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        client`INSERT INTO layouts (id, project_id, site_id, parent_id, data) VALUES ('wrong-id', ${projectA}, ${root.siteId}, NULL, ${JSON.stringify(root)}::jsonb)`,
      ).rejects.toMatchObject({ code: "23514" });
      expect(await repository.get(projectA, root.layoutId)).toEqual(root);
    });
    it("allows scoped scenario references and rejects missing or cross-project layouts", async () => {
      const scenarios = createPostgresScenarioRepository(() => db);
      const make = (id: string, projectId: string, layoutId: string | null) =>
        createRootScenario({
          id,
          projectId,
          layoutId,
          siteIds: [root.siteId],
          profileVersion: 1,
          label: "Layout scenario",
          author: "founder",
          createdAt: "2026-11-14T00:00:00Z",
        });
      expect(
        (await scenarios.insert(make("with-layout", projectA, root.layoutId)))
          .layoutId,
      ).toBe(root.layoutId);
      expect(
        (await scenarios.insert(make("without-layout", projectA, null)))
          .layoutId,
      ).toBeNull();
      await expect(
        scenarios.insert(make("cross-layout", projectB, root.layoutId)),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        scenarios.insert(make("missing-layout", projectA, "missing")),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        client`DELETE FROM layouts WHERE id = ${root.layoutId}`,
      ).rejects.toMatchObject({ code: "23503" });
    });
  },
);
