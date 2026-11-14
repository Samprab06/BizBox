import { describe, expect, it, vi } from "vitest";
import { InteriorResponseSchema } from "../contracts/interior";
import { getInteriorFixture } from "./fixtures";
import { resolveInterior, InteriorNotFoundError } from "./service";
import { readInteriorSite } from "./repository";

const provenance = {
  origin: "costar" as const,
  provider: "costar" as const,
  mode: "live" as const,
  scope: "space" as const,
  description: "Synthetic test mapping",
  limitations: [],
};
const site = {
  siteId: "12:34",
  propertyId: "56",
  floorPlanUri: "https://example.invalid/plan.png",
  models: [
    {
      modelId: "Synthetic01",
      spaceId: "12:34",
      displayApproved: true,
      hasExterior: null,
      dimensions: null,
      source: provenance,
    },
  ],
};

describe("interior selection", () => {
  it.each(["scan", "floorplan", "modeled"] as const)(
    "serves an explicitly synthetic %s without data access",
    async (kind) => {
      const result = await resolveInterior(
        `interior-fixture-${kind}`,
        async () => {
          throw new Error("must stay offline");
        },
      );
      expect(result.kind).toBe(kind);
      expect(result.provenance.mode).toBe("synthetic");
      expect(result.provenance.origin).toBe("default");
      expect(InteriorResponseSchema.safeParse(result).success).toBe(true);
    },
  );
  it("keeps unapproved private models and floor plans out of the response", async () => {
    const result = await resolveInterior("12:34", async () => site);
    expect(result.kind).toBe("modeled");
    expect(JSON.stringify(result)).not.toMatch(/Synthetic01|example.invalid/);
  });
  it("prefers an approved exact-space scan over property models", async () => {
    const result = await resolveInterior(
      "12:34",
      async () => ({
        ...site,
        models: [
          { ...site.models[0]!, modelId: "Property001", spaceId: null },
          site.models[0]!,
        ],
      }),
      { allowLicensedAssets: true },
    );
    expect(result).toMatchObject({ kind: "scan", modelId: "Synthetic01" });
    expect(result).not.toHaveProperty("dimensions");
  });
  it("marks property geometry as unsuitable for suite capacity", async () => {
    const fixture = getInteriorFixture("interior-fixture-scan");
    if (fixture?.kind !== "scan") throw new Error("Missing scan fixture");
    const result = await resolveInterior(
      "12:34",
      async () => ({
        ...site,
        models: [
          {
            ...site.models[0]!,
            spaceId: null,
            dimensions: fixture.dimensions!,
          },
        ],
      }),
      { allowLicensedAssets: true },
    );
    expect(result.provenance.scope).toBe("property");
    expect(result.provenance.limitations.join(" ")).toMatch(/suite/);
    if (result.kind !== "scan") throw new Error("Missing scan");
    expect(result.dimensions?.provenance.scope).toBe("property");
    expect(result.dimensions?.provenance.limitations.join(" ")).toMatch(
      /suite/,
    );
  });
  it("falls back from unapproved scan to floorplan, then modeled", async () => {
    const unapproved = {
      ...site,
      models: [{ ...site.models[0]!, displayApproved: false }],
    };
    expect(
      await resolveInterior("12:34", async () => unapproved, {
        allowLicensedAssets: true,
      }),
    ).toMatchObject({
      kind: "floorplan",
      floorPlanUri: "https://example.invalid/plan.png",
    });
    expect(
      await resolveInterior(
        "12:34",
        async () => ({ ...unapproved, floorPlanUri: null }),
        { allowLicensedAssets: true },
      ),
    ).toMatchObject({ kind: "modeled" });
  });
  it("does not treat an unknown site as a modeled candidate", async () => {
    await expect(
      resolveInterior("12:34", async () => null),
    ).rejects.toBeInstanceOf(InteriorNotFoundError);
  });
  it("rejects contradictory branch fields and unsafe geometry", () => {
    expect(
      InteriorResponseSchema.safeParse({
        ...getInteriorFixture("interior-fixture-modeled"),
        modelId: "Synthetic01",
      }).success,
    ).toBe(false);
    const scan = getInteriorFixture("interior-fixture-scan");
    expect(
      InteriorResponseSchema.safeParse({
        ...scan,
        showcaseParams: { apiToken: "private" },
      }).success,
    ).toBe(false);
    if (scan?.kind !== "scan" || !scan.dimensions)
      throw new Error("Missing scan fixture");
    const invalid = structuredClone(scan);
    invalid.dimensions!.floors[0]!.bounds.max.x = -1;
    expect(InteriorResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("interior source repository", () => {
  it("uses a narrow space projection without requiring attachment storage", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "12:34",
          property_id: "56",
          floor_plan_uri: "https://example.invalid/a.png",
        },
      ])
      .mockResolvedValueOnce([]);
    expect(await readInteriorSite({ execute }, "12:34")).toMatchObject({
      siteId: "12:34",
      propertyId: "56",
      models: [],
    });
  });
  it("surfaces a missing registry rather than fabricating empty inventory", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "12:34", property_id: "56", floor_plan_uri: null },
      ])
      .mockRejectedValueOnce(
        new Error("relation matterport_models does not exist"),
      );
    await expect(readInteriorSite({ execute }, "12:34")).rejects.toThrow();
  });
});
