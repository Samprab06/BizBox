import { describe, it, expect } from "vitest";
import { readInteriorSite } from "./repository";
import { resolveInterior } from "./service";
it("discovers canonical source models without approving or displaying them", async () => {
  const responses = [
    [
      {
        id: "1:2",
        property_id: "3",
        floor_plan_uri: null,
        discovered: [
          {
            modelId: "Abc12345678",
            scope: "property",
            sourceField: "attachments.0.videoKey",
          },
          {
            modelId: "Exact123456",
            scope: "space",
            sourceField: "attachments.0.videoKey",
          },
          { modelId: "bad", scope: "space", sourceField: "x" },
        ],
      },
    ],
    [],
  ];
  const site = await readInteriorSite(
    { execute: async () => responses.shift() },
    "1:2",
  );
  const result = await resolveInterior("1:2", async () => site, {
    allowLicensedAssets: true,
  });
  expect(result.kind).toBe("modeled");
  expect(result.discovery?.models).toHaveLength(2);
  expect(
    result.discovery?.models.every((m) => m.displayApproved === false),
  ).toBe(true);
  expect(result.discovery?.models.map((m) => m.scope)).toContain("space");
});
describe("bounded discovery", () => {
  it("does not alter fixture responses", async () => {
    const r = await resolveInterior("interior-fixture-scan", async () => null);
    expect(r).toBeTruthy();
  });
});

it("caps metadata and signals incomplete discovery without displaying it", async () => {
  const discovered = Array.from({ length: 9 }, (_, i) => ({
    modelId: `Abc1234567${i}`,
    scope: "property",
    sourceField: `attachments.${i}.videoKey`,
  }));
  const responses = [[{ id: "1:2", property_id: "3", discovered }], []];
  const site = await readInteriorSite(
    { execute: async () => responses.shift() },
    "1:2",
  );
  expect(site?.discovery?.models).toHaveLength(8);
  expect(site?.discovery?.truncated).toBe(true);
});
it("opens only canonical discovered public sources and prefers exact space without registry writes", async () => {
  const site = {
    siteId: "1:2",
    propertyId: "3",
    floorPlanUri: null,
    models: [],
    trustedDiscovery: true as const,
    discovery: {
      models: [
        {
          modelId: "Prop1234567",
          scope: "property" as const,
          sourceField: "attachments.0.videoKey",
          displayApproved: false,
          reason: "discovered",
        },
        {
          modelId: "Space123456",
          scope: "space" as const,
          sourceField: "attachments.0.videoKey",
          displayApproved: false,
          reason: "discovered",
        },
      ],
      truncated: false,
      limitations: [],
    },
  };
  const before = structuredClone(site),
    check = async () => "public" as const;
  const result = await resolveInterior("1:2", async () => site, {
    allowLicensedAssets: true,
    publicChecker: check,
  });
  expect(result.kind === "scan" && result.modelId).toBe("Space123456");
  expect(site).toEqual(before);
  expect(
    result.discovery?.models.find((m) => m.modelId === "Space123456"),
  ).toMatchObject({
    displayApproved: false,
    publicStatus: "public",
    viewingEligible: true,
  });
  for (const status of ["private", "unknown"] as const) {
    expect(
      (
        await resolveInterior("1:2", async () => site, {
          allowLicensedAssets: true,
          publicChecker: async () => status,
        })
      ).kind,
    ).toBe("modeled");
  }
  expect(
    (
      await resolveInterior(
        "1:2",
        async () => ({ ...site, trustedDiscovery: undefined }),
        { allowLicensedAssets: true, publicChecker: check },
      )
    ).kind,
  ).toBe("modeled");
});

it("does not auto-open a public apartment tour as a selected commercial interior", async () => {
  const site = {
    siteId: "1:2",
    propertyId: "3",
    floorPlanUri: null,
    models: [],
    trustedDiscovery: true as const,
    discovery: {
      models: [
        {
          modelId: "Abc12345678",
          scope: "property" as const,
          sourceField: "attachments.0.videoKey",
          displayApproved: false,
          reason: "discovered",
        },
      ],
      truncated: false,
      limitations: [],
    },
  };
  const checker = Object.assign(async () => "public" as const, {
    inspect: async () => ({
      status: "public" as const,
      title: "2BR, 2BA",
      excludedBusinessTour: true,
    }),
  });
  const result = await resolveInterior("1:2", async () => site, {
    allowLicensedAssets: true,
    publicChecker: checker,
  });
  expect(result.kind).toBe("modeled");
  expect(result.discovery?.models[0]).toMatchObject({
    publicStatus: "public",
    viewingEligible: false,
  });
  expect(result.provenance.limitations.join(" ")).toMatch(/dwelling/);
});

it("blocks parent-property Pool but retains exact-space pool association", async () => {
  const checker = Object.assign(async () => "public" as const, {
    inspect: async () => ({ status: "public" as const, title: "Pool" }),
  });
  for (const scope of ["property", "space"] as const) {
    const site = {
      siteId: "1:2",
      propertyId: "3",
      floorPlanUri: null,
      models: [],
      trustedDiscovery: true as const,
      discovery: {
        models: [
          {
            modelId: "Abc12345678",
            scope,
            sourceField: "attachments.0.videoKey",
            displayApproved: false,
            reason: "discovered",
          },
        ],
        truncated: false,
        limitations: [],
      },
    };
    expect(
      (
        await resolveInterior("1:2", async () => site, {
          allowLicensedAssets: true,
          publicChecker: checker,
        })
      ).kind,
    ).toBe(scope === "space" ? "scan" : "modeled");
  }
});
