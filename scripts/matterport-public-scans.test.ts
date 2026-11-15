import { describe, expect, it, vi } from "vitest";
import {
  CONFIRM_FLAG,
  createOEmbedChecker,
  discoverPublicScans,
  mappingId,
  parseCliArgs,
  readPostgresCandidates,
  selectMappings,
  type DiscoveryDeps,
  type PublicCheckResult,
  type RegistryEntry,
  type RegistryWrite,
  type ScanCandidate,
} from "./matterport-public-scans";
import { normalizeMatterportManifest } from "./load-matterport";

// Invented identifiers only: no CoStar-derived IDs appear in tests.
const candidates: ScanCandidate[] = [
  { modelId: "PublicAAAA1", propertyId: "101", spaceId: "9001:1" },
  { modelId: "PublicAAAA1", propertyId: "101", spaceId: null },
  { modelId: "PublicAAAA1", propertyId: "101", spaceId: "9001:1" },
  { modelId: "PrivateBBB2", propertyId: "102", spaceId: null },
  { modelId: "FlakyCCCCC3", propertyId: "103", spaceId: null },
  { modelId: "bad-id", propertyId: "104", spaceId: null },
];
const results: Record<string, PublicCheckResult> = {
  PublicAAAA1: "public",
  PrivateBBB2: "private",
  FlakyCCCCC3: "unknown",
};
const synthetic: RegistryEntry = {
  id: mappingId({
    modelId: "Synthetic01",
    propertyId: "990096",
    spaceId: "990096:1",
  }),
  modelId: "Synthetic01",
  propertyId: "990096",
  spaceId: "990096:1",
  isPublic: null,
  checkedAt: null,
  synthetic: true,
};

/** In-memory registry mirroring the upsert: conflicts update only the check. */
function harness(input = candidates, start = new Date("2026-11-14T00:00:00Z")) {
  const rows = new Map<string, RegistryEntry & { displayApproved: boolean }>([
    [synthetic.id, { ...synthetic, displayApproved: false }],
  ]);
  let now = start;
  const check = vi.fn(async (id: string) => results[id] ?? "unknown");
  const sleep = vi.fn(async () => {});
  const deps: DiscoveryDeps = {
    readCandidates: async () => input,
    readRegistry: async () => [...rows.values()].map((r) => ({ ...r })),
    check,
    sleep,
    now: () => now,
    write: async (writes: RegistryWrite[]) => {
      for (const w of writes) {
        const prior = rows.get(w.id);
        if (prior?.synthetic) continue;
        rows.set(w.id, {
          id: w.id,
          modelId: w.modelId,
          propertyId: w.costarPropertyId,
          spaceId: w.costarSpaceId ?? null,
          synthetic: false,
          displayApproved: prior?.displayApproved ?? false,
          isPublic: w.isPublic,
          checkedAt: w.checkedAt,
        });
      }
    },
  };
  return {
    deps,
    rows,
    check,
    sleep,
    advance: (days: number) => {
      now = new Date(now.getTime() + days * 86_400_000);
    },
  };
}

describe("selectMappings", () => {
  it("deduplicates, drops invalid IDs and prefers space-scoped rows", () => {
    const { mappings, invalid } = selectMappings(candidates);
    expect(invalid).toBe(1);
    expect(
      mappings.filter((m) => m.modelId === "PublicAAAA1").map((m) => m.spaceId),
    ).toEqual(["9001:1"]);
    expect(mappings).toHaveLength(3);
  });
  it("shares the manifest loader's row key", () => {
    const source = {
      origin: "default",
      provider: "modeled",
      mode: "synthetic",
      scope: "demo",
      description: "Invented",
      limitations: [],
    };
    const [row] = normalizeMatterportManifest({
      version: 1,
      models: [
        {
          modelId: "PublicAAAA1",
          costarPropertyId: "101",
          costarSpaceId: "9001:1",
          hasExterior: null,
          source,
        },
      ],
    });
    expect(
      mappingId({
        modelId: "PublicAAAA1",
        propertyId: "101",
        spaceId: "9001:1",
      }),
    ).toBe(row!.id);
  });
});

describe("discoverPublicScans", () => {
  it("checks each model once at a polite rate and prints only aggregate counts", async () => {
    const h = harness();
    const result = await discoverPublicScans(h.deps, { intervalMs: 10 });
    expect(result).toEqual({
      mappings: 3,
      spaceScoped: 1,
      invalidCandidates: 1,
      skippedSynthetic: 0,
      models: 3,
      fresh: 0,
      checked: 3,
      public: 1,
      private: 1,
      unknown: 1,
      rowsWritten: 2,
    });
    expect(h.check).toHaveBeenCalledTimes(3);
    // Sleeps between requests, clamped to the minimum interval.
    expect(h.sleep).toHaveBeenCalledTimes(2);
    expect(h.sleep).toHaveBeenCalledWith(500);
    expect(JSON.stringify(result)).not.toMatch(/AAAA|BBB|CCC|101|9001/);
    const written = [...h.rows.values()].filter((r) => !r.synthetic);
    expect(written.map((r) => [r.modelId, r.spaceId, r.isPublic])).toEqual(
      expect.arrayContaining([
        ["PublicAAAA1", "9001:1", true],
        ["PrivateBBB2", null, false],
      ]),
    );
    expect(written.every((r) => r.displayApproved === false)).toBe(true);
  });
  it("is idempotent: a second run re-checks only inconclusive models", async () => {
    const h = harness();
    await discoverPublicScans(h.deps);
    const before = JSON.stringify([...h.rows.entries()]);
    h.check.mockClear();
    const second = await discoverPublicScans(h.deps);
    expect(h.check.mock.calls.map(([id]) => id)).toEqual(["FlakyCCCCC3"]);
    expect(second).toMatchObject({ fresh: 2, checked: 1, rowsWritten: 0 });
    expect(JSON.stringify([...h.rows.entries()])).toBe(before);
  });
  it("re-checks entries older than the max age, since owners can make scans private", async () => {
    const h = harness();
    await discoverPublicScans(h.deps, { maxAgeDays: 30 });
    results.PublicAAAA1 = "private";
    try {
      h.advance(10);
      h.check.mockClear();
      await discoverPublicScans(h.deps, { maxAgeDays: 30 });
      expect(h.check).toHaveBeenCalledTimes(1);
      h.advance(25);
      h.check.mockClear();
      const result = await discoverPublicScans(h.deps, { maxAgeDays: 30 });
      expect(h.check).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({ public: 0, private: 2 });
      const row = [...h.rows.values()].find((r) => r.modelId === "PublicAAAA1");
      expect(row?.isPublic).toBe(false);
    } finally {
      results.PublicAAAA1 = "public";
    }
  });
  it("keeps an existing property-level row current alongside the preferred space row", async () => {
    const h = harness();
    const property = {
      modelId: "PublicAAAA1",
      propertyId: "101",
      spaceId: null,
    };
    h.rows.set(mappingId(property), {
      ...property,
      id: mappingId(property),
      isPublic: null,
      checkedAt: null,
      synthetic: false,
      displayApproved: true,
    });
    await discoverPublicScans(h.deps);
    const row = h.rows.get(mappingId(property))!;
    expect(row).toMatchObject({ isPublic: true, displayApproved: true });
  });
  it("leaves fixture models unchanged and never checks them", async () => {
    const h = harness([
      ...candidates,
      { modelId: "Synthetic01", propertyId: "990096", spaceId: "990096:1" },
    ]);
    const before = structuredClone(h.rows.get(synthetic.id));
    const result = await discoverPublicScans(h.deps);
    expect(result.skippedSynthetic).toBe(1);
    expect(h.check).not.toHaveBeenCalledWith("Synthetic01");
    expect(h.rows.get(synthetic.id)).toEqual(before);
  });
  it("treats a thrown check as inconclusive and writes nothing for it", async () => {
    const h = harness([
      { modelId: "PublicAAAA1", propertyId: "101", spaceId: null },
    ]);
    h.check.mockRejectedValueOnce(new Error("network"));
    expect(await discoverPublicScans(h.deps)).toMatchObject({
      unknown: 1,
      rowsWritten: 0,
    });
  });
});

describe("oEmbed checker (fake fetch only)", () => {
  it.each([
    [200, "public"],
    [401, "private"],
    [404, "private"],
    [429, "unknown"],
    [500, "unknown"],
  ] as const)("maps HTTP %i to %s", async (status, expected) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    expect(await createOEmbedChecker(fetcher)("PublicAAAA1")).toBe(expected);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("oembed");
  });
  it("never sends a malformed ID", async () => {
    const fetcher = vi.fn();
    expect(await createOEmbedChecker(fetcher)("x/../y")).toBe("unknown");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("CLI gate", () => {
  it("refuses without the HAC-14 confirmation flag", () => {
    const plan = parseCliArgs([]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/HAC-14/);
    expect(parseCliArgs(["--max-age-days", "7"]).ok).toBe(false);
  });
  it("accepts the flag with options and rejects unknown or unsafe ones", () => {
    expect(
      parseCliArgs([
        CONFIRM_FLAG,
        "--max-age-days",
        "7",
        "--interval-ms",
        "2000",
      ]),
    ).toEqual({ ok: true, maxAgeDays: 7, intervalMs: 2000 });
    expect(parseCliArgs([CONFIRM_FLAG, "--interval-ms", "10"]).ok).toBe(false);
    expect(parseCliArgs([CONFIRM_FLAG, "--write"]).ok).toBe(false);
  });
});

describe("candidate query", () => {
  it("maps rows and keeps unscoped attachments property-level", async () => {
    const execute = vi.fn().mockResolvedValue([
      { model_id: "PublicAAAA1", property_id: "101", space_id: "9001:1" },
      { model_id: "PrivateBBB2", property_id: "102", space_id: null },
    ]);
    expect(await readPostgresCandidates({ execute })).toEqual([
      { modelId: "PublicAAAA1", propertyId: "101", spaceId: "9001:1" },
      { modelId: "PrivateBBB2", propertyId: "102", spaceId: null },
    ]);
  });
});
