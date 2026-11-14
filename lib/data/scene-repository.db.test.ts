import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SceneResponseSchema } from "@/lib/contracts/scene";
import { SceneNotFoundError, readScene } from "./scene-repository";

const enabled =
  process.env.RUN_SCENE_DB_TESTS === "1" &&
  !!process.env.SCENE_TEST_DATABASE_URL;

/**
 * A loopback PostGIS database with the CoStar kit and the public data loaded (`pnpm
 * db:load`). Read-only: every read runs in a read-only transaction. Never uses DATABASE_URL.
 * Site IDs are discovered from the data, so no sponsor record IDs live in this file.
 */
describe.skipIf(!enabled)(
  "scene repository on local PostGIS [local]",
  { timeout: 60_000 },
  () => {
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;
    let suiteId: string;
    let propertyId: string;

    const run = <T>(
      work: (
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      ) => Promise<T>,
    ) =>
      db.transaction((tx) => work(tx), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    const keysOf = (value: unknown, found = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
      else if (value && typeof value === "object")
        for (const [key, entry] of Object.entries(value)) {
          found.add(key);
          keysOf(entry, found);
        }
      return found;
    };

    beforeAll(async () => {
      const url = new URL(process.env.SCENE_TEST_DATABASE_URL!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new Error("Scene DB tests require a loopback database");
      client = postgres(url.toString(), { max: 2, connect_timeout: 5 });
      db = drizzle(client);
      const [space] = await client<{ id: string; property_id: string }[]>`
      SELECT s.id, s.property_id FROM costar_spaces s
      JOIN costar_properties p ON p.id = s.property_id
      WHERE s.active AND s.retail AND p.point IS NOT NULL
      ORDER BY s.id LIMIT 1`;
      suiteId = space.id;
      propertyId = space.property_id;
    });
    afterAll(async () => {
      await client?.end();
    });

    it("returns a valid, bounded scene for a suite site", async () => {
      const scene = await run((tx) =>
        readScene(
          tx,
          suiteId,
          { radiusMeters: 1609, ringMeters: [] },
          "founder",
        ),
      );
      expect(SceneResponseSchema.parse(scene)).toBeTruthy();
      expect(scene.suite?.id).toBe(suiteId);
      expect(scene.site.propertyId).toBe(propertyId);
      expect(scene.parentProperty.id).toBe(propertyId);
      expect(scene.nearbyProperties.map((p) => p.id)).not.toContain(propertyId);
      for (const near of scene.nearbyProperties)
        expect(near.distanceMeters).toBeLessThanOrEqual(1609);
      for (const place of scene.competitors)
        expect(place.distanceMeters).toBeLessThanOrEqual(1609);
      const distances = scene.competitors.map((c) => c.distanceMeters);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      expect(scene.blockGroups.length).toBeGreaterThan(0);
      expect(scene.rings.at(-1)?.radiusMeters).toBe(1609);
    });

    it("never returns raw CoStar payload keys", async () => {
      const scene = await run((tx) =>
        readScene(
          tx,
          suiteId,
          { radiusMeters: 1609, ringMeters: [] },
          "default",
        ),
      );
      const keys = keysOf(scene);
      for (const forbidden of [
        "data",
        "source",
        "provenance_blob",
        "decodedEnums",
        "floorPlan",
        "primaryAddress",
        "company",
        "profile",
      ])
        expect(keys.has(forbidden)).toBe(false);
    });

    it("serves a property site without a suite", async () => {
      const scene = await run((tx) =>
        readScene(
          tx,
          propertyId,
          { radiusMeters: 1000, ringMeters: [400] },
          "default",
        ),
      );
      expect(SceneResponseSchema.parse(scene)).toBeTruthy();
      expect(scene.suite).toBeNull();
      expect(scene.rings.map((r) => r.kind)).toEqual(["inner", "catchment"]);
    });

    it("rejects an unknown site and returns empty arrays for an empty area", async () => {
      await expect(
        run((tx) =>
          readScene(
            tx,
            "999999999",
            { radiusMeters: 1000, ringMeters: [] },
            "default",
          ),
        ),
      ).rejects.toBeInstanceOf(SceneNotFoundError);
      // A 100 m scene around a far-flung property can legitimately be empty of neighbors.
      const scene = await run((tx) =>
        readScene(
          tx,
          propertyId,
          { radiusMeters: 100, ringMeters: [] },
          "founder",
        ),
      );
      expect(Array.isArray(scene.nearbyProperties)).toBe(true);
      expect(Array.isArray(scene.competitors)).toBe(true);
    });

    it("uses the geography GiST indexes for every ST_DWithin", async () => {
      const statements: { sql: string; params: unknown[] }[] = [];
      await run((tx) =>
        readScene(
          {
            execute: (query: SQL) => {
              statements.push(new PgDialect().sqlToQuery(query));
              return tx.execute(query);
            },
          },
          suiteId,
          { radiusMeters: 1609, ringMeters: [] },
          "default",
        ),
      );
      const spatial = statements.filter((s) => s.sql.includes("ST_DWithin"));
      expect(spatial).toHaveLength(3);
      const indexes = new Set<string>();
      for (const statement of spatial) {
        const plan = await client.begin("read only", async (tx) => {
          await tx.unsafe("SET LOCAL enable_seqscan = on");
          return tx.unsafe(
            `EXPLAIN (FORMAT JSON) ${statement.sql}`,
            statement.params as never[],
          );
        });
        const text = JSON.stringify(plan);
        for (const index of [
          "costar_properties_geog_idx",
          "public_places_geog_idx",
          "public_block_groups_geog_idx",
        ])
          if (text.includes(index)) indexes.add(index);
      }
      expect([...indexes].sort()).toEqual([
        "costar_properties_geog_idx",
        "public_block_groups_geog_idx",
        "public_places_geog_idx",
      ]);
    });
  },
);
