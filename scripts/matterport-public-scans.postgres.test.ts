import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runPublicScanDiscovery } from "./matterport-public-scans";

// Same opt-in as lib/interior/postgres.test.ts: a disposable loopback database.
const enabled =
  process.env.RUN_INTERIOR_DB_TESTS === "1" &&
  !!process.env.INTERIOR_TEST_DATABASE_URL;

describe.skipIf(!enabled)("public-scan discovery on PostgreSQL [local]", () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let url: string;
  let databaseName: string;
  const synthetic = {
    origin: "default",
    provider: "modeled",
    mode: "synthetic",
    scope: "demo",
    description: "Authored fixture",
    limitations: [],
  };

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
    client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
    // Only the registry migrations: the CoStar source tables are standalone DDL,
    // reduced here to the columns the discovery query reads (no PostGIS needed).
    for (const file of [
      "drizzle/0004_matterport_models.sql",
      "drizzle/0008_matterport-public-scans.sql",
    ])
      for (const statement of (await readFile(file, "utf8")).split(
        "--> statement-breakpoint",
      ))
        await client.unsafe(statement);
    await client.unsafe(`
      CREATE TABLE costar_spaces (id text PRIMARY KEY, listing_id text NOT NULL,
        property_id text NOT NULL, active boolean NOT NULL, retail boolean NOT NULL,
        data jsonb NOT NULL, source jsonb NOT NULL);
      CREATE TABLE costar_attachments (id text PRIMARY KEY, property_id text,
        data jsonb NOT NULL, source jsonb NOT NULL);
    `);
    const space = (
      id: string,
      listing: string,
      property: string,
      index: number,
      retail: boolean,
    ) =>
      client`INSERT INTO costar_spaces VALUES (${id}, ${listing}, ${property}, true, ${retail}, '{}'::jsonb,
        ${client.json({ origin: "costar", dataset: "commercial-listing-summary", recordId: listing, field: `forLeaseSummary.spaces[${index}].id` })})`;
    await space("700:1", "700", "101", 0, true);
    await space("700:2", "700", "101", 1, true);
    await space("800:1", "800", "102", 0, true);
    await space("900:1", "900", "103", 0, false);
    const attachment = (
      id: string,
      property: string,
      model: string,
      dataset: string,
      recordId: string,
      field: string,
    ) =>
      client`INSERT INTO costar_attachments VALUES (${id}, ${property},
        ${client.json({ matterportModelId: model })},
        ${client.json({ origin: "costar", dataset, recordId, field })})`;
    // Space-scoped and property-level references to the same model.
    await attachment(
      "a1",
      "101",
      "PublicAAAA1",
      "commercial-listing-summary",
      "700",
      "forLeaseSummary.spaces[1].attachments[0]",
    );
    await attachment(
      "a2",
      "101",
      "PublicAAAA1",
      "commercial-property",
      "101",
      "attachments[3]",
    );
    await attachment(
      "a3",
      "102",
      "PrivateBBB2",
      "commercial-property",
      "102",
      "attachments[0]",
    );
    // Non-retail property: never sent to the checker.
    await attachment(
      "a4",
      "103",
      "NonRetail03",
      "commercial-property",
      "103",
      "attachments[0]",
    );
    await client`INSERT INTO matterport_models(id, model_id, costar_property_id, costar_space_id, source)
      VALUES (${"a".repeat(64)}, 'Synthetic01', '990096', '990096:1', ${client.json(synthetic)})`;
  }, 30_000);
  afterAll(async () => {
    if (client) await client.end({ timeout: 5 });
    if (admin) {
      if (databaseName)
        await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end({ timeout: 5 });
    }
  });

  it("writes space-preferred check results idempotently and leaves fixtures alone", async () => {
    const check = vi.fn(async (id: string) =>
      id === "PublicAAAA1" ? ("public" as const) : ("private" as const),
    );
    const first = await runPublicScanDiscovery(url, { check, intervalMs: 500 });
    expect(first).toMatchObject({
      mappings: 2,
      spaceScoped: 1,
      checked: 2,
      public: 1,
      private: 1,
      rowsWritten: 2,
    });
    expect(check.mock.calls.map(([id]) => id).sort()).toEqual([
      "PrivateBBB2",
      "PublicAAAA1",
    ]);
    const rows = async () =>
      client`SELECT model_id, costar_space_id, is_public, display_approved, checked_at
             FROM matterport_models ORDER BY model_id`;
    const after = await rows();
    expect(
      after.map((r) => [
        r.model_id,
        r.costar_space_id,
        r.is_public,
        r.display_approved,
      ]),
    ).toEqual([
      ["PrivateBBB2", null, false, false],
      ["PublicAAAA1", "700:2", true, false],
      ["Synthetic01", "990096:1", null, false],
    ]);
    check.mockClear();
    const second = await runPublicScanDiscovery(url, { check });
    expect(check).not.toHaveBeenCalled();
    expect(second).toMatchObject({ fresh: 2, checked: 0, rowsWritten: 0 });
    expect(await rows()).toEqual(after);
  });
  it("rejects a check result without a timestamp", async () => {
    await expect(
      client`UPDATE matterport_models SET is_public=true WHERE model_id='Synthetic01'`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
