import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import type { BusinessProfile } from "@/lib/contracts";
import { createPostgresProfileStore } from "./store-postgres";
import { profileContentKey } from "./store";

vi.mock("server-only", () => ({}));

const profile = syntheticHoustonFixture.profile;

/** Minimal in-memory stand-in for the Drizzle calls the store makes. */
function fakeDatabase() {
  const rows: { id: string; version: number; snapshot: BusinessProfile }[] = [];
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "for", "orderBy", "limit"])
      c[k] = () => c;
    c.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return c;
  };
  let selects = 0;
  const tx = {
    select: () =>
      chain(() =>
        selects++ % 2 === 0
          ? [{ id: profile.projectId }]
          : [...rows].sort((a, b) => b.version - a.version).slice(0, 1),
      ),
    insert: () => ({
      values: async (v: (typeof rows)[number]) => void rows.push(v),
    }),
  };
  return {
    rows,
    db: (() => ({
      transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    })) as never,
  };
}

describe("profile save idempotency", () => {
  it("reuses versions for absent versus empty map rules but versions nonempty selections and clears", async () => {
    const { db, rows } = fakeDatabase();
    let n = 0;
    const store = createPostgresProfileStore(db, () => `map_profile_${++n}`);
    const first = await store.saveSnapshot(profile.projectId, profile);
    const empty = {
      ...profile,
      areaPreferences: { city: "Houston" as const, rectangles: [] },
    };
    expect(await store.saveSnapshot(profile.projectId, empty)).toEqual(first);
    expect(rows).toHaveLength(1);

    const selected = await store.saveSnapshot(profile.projectId, {
      ...profile,
      areaPreferences: {
        city: "Houston",
        rectangles: [{ bounds: [-95.5, 29.6, -95.3, 29.8], brush: "avoid" }],
      },
    });
    expect(selected?.version).toBe(2);
    const cleared = await store.saveSnapshot(profile.projectId, empty);
    expect(cleared?.version).toBe(3);
    expect(await store.saveSnapshot(profile.projectId, profile)).toEqual(cleared);
    expect(rows).toHaveLength(3);
    expect(rows[1].snapshot.areaPreferences?.rectangles).toHaveLength(1);
  });

  it("persists map preferences and versions changes and explicit clears without mutating history", async () => {
    const { db, rows } = fakeDatabase();
    let n = 0;
    const store = createPostgresProfileStore(db, () => `area_profile_${++n}`);
    const first = await store.saveSnapshot(profile.projectId, profile);
    const geometry = {
      city: "Houston" as const,
      rectangles: [
        {
          bounds: [-95.5, 29.6, -95.3, 29.8] as [
            number,
            number,
            number,
            number,
          ],
          brush: "avoid" as const,
        },
      ],
    };
    const second = await store.saveSnapshot(profile.projectId, {
      ...profile,
      areaPreferences: geometry,
    });
    expect(second).toMatchObject({ version: 2, areaPreferences: geometry });
    expect(rows[1].snapshot.areaPreferences).toEqual(geometry);
    expect(rows[0].snapshot.areaPreferences).toBeUndefined();
    expect(await store.saveSnapshot(profile.projectId, second!)).toEqual(
      second,
    );
    const cleared = await store.saveSnapshot(profile.projectId, {
      ...second!,
      areaPreferences: { city: "Houston", rectangles: [] },
    });
    expect(cleared).toMatchObject({
      version: 3,
      areaPreferences: { rectangles: [] },
    });
    expect(first?.version).toBe(1);
    expect(rows).toHaveLength(3);
  });

  it("returns the existing version for identical content and bumps on change", async () => {
    const { db, rows } = fakeDatabase();
    let n = 0;
    const store = createPostgresProfileStore(db, () => `profile_${++n}`);
    const first = await store.saveSnapshot(profile.projectId, profile);
    const again = await store.saveSnapshot(profile.projectId, {
      ...profile,
      id: "client_other_id",
      version: 99,
    });
    expect(first?.version).toBe(1);
    expect(again).toEqual(first);
    expect(rows).toHaveLength(1);
    const changed = await store.saveSnapshot(profile.projectId, {
      ...profile,
      businessName: "A different name",
    });
    expect(changed?.version).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it("content key ignores identity and key order", () => {
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(profile).reverse())),
    );
    expect(profileContentKey({ ...reordered, id: "x", version: 7 })).toBe(
      profileContentKey(profile),
    );
  });
});
