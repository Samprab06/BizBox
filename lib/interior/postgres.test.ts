import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import * as schema from "../db/schema";
import {
  loadMatterport,
  normalizeMatterportManifest,
} from "../../scripts/load-matterport";
import { createPostgresDimensionsProvider } from "./cache-postgres";
import { normalizeMatterportDimensions } from "./model-api";
import { syntheticModelApiResponse } from "./__fixtures__/model-api";

const enabled =
  process.env.RUN_INTERIOR_DB_TESTS === "1" &&
  !!process.env.INTERIOR_TEST_DATABASE_URL;
describe.skipIf(!enabled)(
  "interior PostgreSQL migration/import/cache [local]",
  () => {
    let admin: ReturnType<typeof postgres>;
    let client: ReturnType<typeof postgres>;
    let url: string;
    let databaseName: string;
    let directory: string;
    let manifestPath: string;
    const source = {
      origin: "default",
      provider: "modeled",
      mode: "synthetic",
      scope: "demo",
      description: "Authored DB integration mapping",
      limitations: ["Not a recording"],
    };
    const model = {
      modelId: "Synthetic01",
      costarPropertyId: "56",
      costarSpaceId: "12:34",
      hasExterior: null,
      source,
    };
    const mapping = {
      modelId: "Synthetic01",
      propertyId: "56",
      spaceId: "12:34",
    };
    const input = (models: unknown[]) => ({ version: 1, models });

    beforeAll(async () => {
      const target = new URL(process.env.INTERIOR_TEST_DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost"].includes(target.hostname) ||
        !/^\/hac96_[a-z0-9_]+$/.test(target.pathname)
      )
        throw new Error(
          "Interior tests require an explicitly named disposable loopback database",
        );
      admin = postgres(target.toString(), { max: 1, connect_timeout: 5 });
      databaseName = `hac96_test_${randomUUID().replaceAll("-", "")}`;
      await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
      target.pathname = `/${databaseName}`;
      url = target.toString();
      client = postgres(url, { max: 2, connect_timeout: 5 });
      await migrate(drizzle(client), { migrationsFolder: "drizzle" });
      directory = await mkdtemp(join(tmpdir(), "hac96-pg-"));
      manifestPath = join(directory, "manifest.json");
    }, 30_000);
    afterAll(async () => {
      if (client) await client.end({ timeout: 5 });
      if (admin) {
        if (databaseName)
          await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
        await admin.end({ timeout: 5 });
      }
      if (directory) await rm(directory, { recursive: true });
    });

    it("applies the complete migration chain twice without source tables or duplicate journal rows", async () => {
      const before = (
        await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`
      )[0]?.count;
      await migrate(drizzle(client), { migrationsFolder: "drizzle" });
      expect(
        (
          await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`
        )[0]?.count,
      ).toBe(before);
      expect(
        (await client`SELECT to_regclass('matterport_models') AS registry`)[0]
          ?.registry,
      ).toBe("matterport_models");
      expect(
        (await client`SELECT to_regclass('costar_spaces') AS source`)[0]
          ?.source,
      ).toBeNull();
    });
    it("imports and reloads duplicate space/property mappings idempotently", async () => {
      await writeFile(
        manifestPath,
        JSON.stringify(
          input([model, model, { ...model, costarSpaceId: null }]),
        ),
      );
      expect(await loadMatterport(manifestPath, url)).toMatchObject({
        mode: "loaded",
        mappings: 2,
      });
      await loadMatterport(manifestPath, url);
      expect(
        (await client`SELECT count(*)::int AS count FROM matterport_models`)[0]
          ?.count,
      ).toBe(2);
      expect(
        (
          await client`SELECT bool_or(display_approved) AS approved FROM matterport_models`
        )[0]?.approved,
      ).toBe(false);
      // Different PK cannot bypass the nullable tuple's database uniqueness.
      await expect(client`INSERT INTO matterport_models(id,model_id,costar_property_id,costar_space_id,source)
      VALUES(${"f".repeat(64)},'Synthetic01','56',NULL,${JSON.stringify(source)}::jsonb)`).rejects.toMatchObject(
        { code: "23505" },
      );
    });
    it("fetches once into the approved mapping cache and preserves it during metadata reload", async () => {
      await client`UPDATE matterport_models SET display_approved=true WHERE costar_space_id='12:34'`;
      let calls = 0;
      const dimensions = normalizeMatterportDimensions(
        syntheticModelApiResponse,
        "Synthetic01",
      )!;
      const provider = createPostgresDimensionsProvider(
        drizzle(client, { schema }),
        {
          async getDimensions() {
            calls++;
            return dimensions;
          },
        },
      );
      expect((await provider(mapping))?.floors[0]?.rooms).toHaveLength(1);
      expect((await provider(mapping))?.floors[0]?.rooms).toHaveLength(1);
      expect(calls).toBe(1);
      await loadMatterport(manifestPath, url);
      const cached = (
        await client`SELECT dimensions,dimensions_recorded_at,display_approved FROM matterport_models WHERE costar_space_id='12:34'`
      )[0]!;
      expect(cached.dimensions).toEqual(dimensions);
      expect(
        Number.isFinite(Date.parse(String(cached.dimensions_recorded_at))),
      ).toBe(true);
      expect(cached.display_approved).toBe(true);
    });
    it("never fetches an unapproved mapping or writes invalid/failed provider geometry", async () => {
      let deniedCalls = 0;
      const denied = createPostgresDimensionsProvider(
        drizzle(client, { schema }),
        {
          async getDimensions() {
            deniedCalls++;
            return undefined;
          },
        },
      );
      expect(await denied({ ...mapping, spaceId: null })).toBeUndefined();
      expect(deniedCalls).toBe(0);
      await client`UPDATE matterport_models SET dimensions=NULL,dimensions_recorded_at=NULL WHERE costar_space_id='12:34'`;
      const failed = createPostgresDimensionsProvider(
        drizzle(client, { schema }),
        {
          async getDimensions() {
            throw new Error("private");
          },
        },
      );
      expect(await failed(mapping)).toBeUndefined();
      expect(
        (
          await client`SELECT dimensions FROM matterport_models WHERE costar_space_id='12:34'`
        )[0]?.dimensions,
      ).toBeNull();
      const invalid = createPostgresDimensionsProvider(
        drizzle(client, { schema }),
        {
          async getDimensions() {
            return {
              ...normalizeMatterportDimensions(
                syntheticModelApiResponse,
                "Synthetic01",
              )!,
              floors: [],
            };
          },
        },
      );
      expect(await invalid(mapping)).toBeUndefined();
      expect(
        (
          await client`SELECT dimensions FROM matterport_models WHERE costar_space_id='12:34'`
        )[0]?.dimensions,
      ).toBeNull();
    });
    it("coalesces concurrent approved cache misses without duplicate provider requests", async () => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const provider = createPostgresDimensionsProvider(
        drizzle(client, { schema }),
        {
          async getDimensions() {
            calls++;
            entered();
            await gate;
            return normalizeMatterportDimensions(
              syntheticModelApiResponse,
              "Synthetic01",
            );
          },
        },
      );
      const first = provider(mapping);
      await started;
      try {
        expect(await provider(mapping)).toBeUndefined();
      } finally {
        release();
      }
      expect((await first)?.floors).toHaveLength(1);
      expect((await provider(mapping))?.floors).toHaveLength(1);
      expect(calls).toBe(1);
    });
    it("rolls back an earlier metadata update when a later insert fails inside the import transaction", async () => {
      const firstId = normalizeMatterportManifest(input([model]))[0]!.id;
      let extra = { ...model, modelId: "Model000001", hasExterior: true };
      for (
        let index = 1;
        normalizeMatterportManifest(input([extra]))[0]!.id <= firstId;
        index++
      )
        extra = { ...extra, modelId: `Model${String(index).padStart(6, "0")}` };
      await client`CREATE FUNCTION reject_test_exterior() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.has_exterior IS TRUE THEN RAISE EXCEPTION 'synthetic import failure'; END IF; RETURN NEW; END $$`;
      await client`CREATE TRIGGER reject_test_exterior BEFORE INSERT OR UPDATE ON matterport_models FOR EACH ROW EXECUTE FUNCTION reject_test_exterior()`;
      await writeFile(
        manifestPath,
        JSON.stringify(
          input([
            {
              ...model,
              source: { ...source, description: "This must roll back" },
            },
            extra,
          ]),
        ),
      );
      await expect(loadMatterport(manifestPath, url)).rejects.toThrow();
      expect(
        (
          await client`SELECT source->>'description' AS description FROM matterport_models WHERE costar_space_id='12:34'`
        )[0]?.description,
      ).toBe("Authored DB integration mapping");
      expect(
        (await client`SELECT count(*)::int AS count FROM matterport_models`)[0]
          ?.count,
      ).toBe(2);
    });
  },
);
