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
      isPublic: true,
      hasExterior: null,
      dimensions: null,
      source: provenance,
    },
  ],
};

describe("interior selection", () => {
  it("loads missing geometry only for an approved selected scan and explains provider absence", async () => {
    let calls = 0;
    const dimensionsProvider = async () => {
      calls++;
      return undefined;
    };
    await resolveInterior("12:34", async () => site, { dimensionsProvider });
    expect(calls).toBe(0);
    const result = await resolveInterior("12:34", async () => site, {
      allowLicensedAssets: true,
      dimensionsProvider,
    });
    expect(calls).toBe(1);
    expect(result.kind).toBe("scan");
    expect(result).not.toHaveProperty("dimensions");
    expect(result.provenance.limitations.join(" ")).toMatch(
      /dimensions unavailable/i,
    );
  });
  it("serves official public-demo metadata without inventing dimensions or calling the provider", async () => {
    const result = await resolveInterior("interior-public-demo", async () => {
      throw new Error("must stay offline");
    });
    expect(result).toMatchObject({
      kind: "scan",
      modelId: "SxQL3iGyoDo",
      provenance: { origin: "public", mode: "recorded", scope: "demo" },
    });
    expect(result).not.toHaveProperty("dimensions");
    expect(result.provenance.description).toMatch(/metadata/i);
  });
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
  describe("public-scan gate (HAC-137)", () => {
    const withModel = (patch: {
      displayApproved: boolean;
      isPublic: boolean | null;
    }) => ({
      ...site,
      floorPlanUri: null,
      models: [{ ...site.models[0]!, ...patch }],
    });
    it("serves a public, display-approved scan", async () => {
      expect(
        await resolveInterior(
          "12:34",
          async () => withModel({ displayApproved: true, isPublic: true }),
          { allowLicensedAssets: true },
        ),
      ).toMatchObject({ kind: "scan", modelId: "Synthetic01" });
    });
    it("keeps a public but unapproved scan out of the response", async () => {
      const result = await resolveInterior(
        "12:34",
        async () => withModel({ displayApproved: false, isPublic: true }),
        { allowLicensedAssets: true },
      );
      expect(result.kind).toBe("modeled");
      expect(JSON.stringify(result)).not.toMatch(/Synthetic01/);
    });
    it.each([
      ["private", false],
      ["never checked", null],
    ] as const)(
      "keeps an approved but %s scan out of the response",
      async (_label, isPublic) => {
        const result = await resolveInterior(
          "12:34",
          async () => withModel({ displayApproved: true, isPublic }),
          { allowLicensedAssets: true },
        );
        expect(result.kind).toBe("modeled");
        expect(result.provenance.limitations.join(" ")).toMatch(
          /approved public scan/,
        );
        expect(JSON.stringify(result)).not.toMatch(/Synthetic01/);
      },
    );
    it("prefers a public approved property scan over a private space scan", async () => {
      const result = await resolveInterior(
        "12:34",
        async () => ({
          ...site,
          models: [
            { ...site.models[0]!, isPublic: false },
            { ...site.models[0]!, modelId: "Property001", spaceId: null },
          ],
        }),
        { allowLicensedAssets: true },
      );
      expect(result).toMatchObject({ kind: "scan", modelId: "Property001" });
    });
    it("leaves the compiled fixtures unchanged", async () => {
      for (const id of [
        "interior-public-demo",
        "interior-fixture-scan",
        "interior-fixture-floorplan",
        "interior-fixture-modeled",
      ])
        expect(
          await resolveInterior(id, async () => {
            throw new Error("must stay offline");
          }),
        ).toEqual(getInteriorFixture(id));
    });
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
  it("reads the public-check flag and treats a missing value as unchecked", async () => {
    const model = {
      model_id: "Synthetic01",
      costar_space_id: "12:34",
      has_exterior: null,
      display_approved: true,
      dimensions: null,
      source: provenance,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "12:34", property_id: "56", floor_plan_uri: null },
      ])
      .mockResolvedValueOnce([
        { ...model, is_public: true },
        { ...model, model_id: "Property001", is_public: null },
      ]);
    const result = await readInteriorSite({ execute }, "12:34");
    expect(result?.models.map((m) => m.isPublic)).toEqual([true, null]);
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
