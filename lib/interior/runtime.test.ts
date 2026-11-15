import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../db/client", () => ({
  getDb() {
    throw new Error("Provider unavailable: private connection details");
  },
}));
import { getInterior } from "./runtime";
import { createInteriorHandler } from "../../app/api/sites/[siteId]/interior/handler";
import { GET as floorplan } from "../../app/api/sites/[siteId]/interior/floorplan/route";

describe("offline interior runtime", () => {
  it("serves fixture content with the database provider unavailable", async () => {
    const response = await createInteriorHandler(getInterior)(
      new Request("http://localhost/interior"),
      { params: Promise.resolve({ siteId: "interior-fixture-scan" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "scan",
      provenance: { mode: "synthetic" },
    });
  });
  it("returns a sanitized 503 for ordinary sites when the provider is unavailable", async () => {
    const response = await createInteriorHandler(getInterior)(
      new Request("http://localhost/interior"),
      { params: Promise.resolve({ siteId: "12:34" }) },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private|connection|Provider/);
  });
  it("provides its authored floorplan locally and does not proxy arbitrary sites", async () => {
    const request = new Request("http://localhost/interior/floorplan");
    const response = await floorplan(request, {
      params: Promise.resolve({ siteId: "interior-fixture-floorplan" }),
    });
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("Synthetic example");
    expect(
      (
        await floorplan(request, {
          params: Promise.resolve({ siteId: "12:34" }),
        })
      ).status,
    ).toBe(404);
  });
});

describe("configured selected candidate runtime", () => {
  it("enables only approved public mappings and attaches the client-permitted SDK key", async () => {
    const { createConfiguredInteriorGetter } = await import("./runtime");
    const readSite = vi.fn(async () => ({
      siteId: "12:34",
      propertyId: "12",
      floorPlanUri: null,
      models: [
        {
          modelId: "Abcdefghi12",
          spaceId: "12:34",
          hasExterior: null,
          displayApproved: true,
          isPublic: true,
          dimensions: null,
          source: {
            origin: "costar" as const,
            provider: "costar" as const,
            mode: "live" as const,
            scope: "space" as const,
            description: "Approved selected scan",
            limitations: [],
          },
        },
      ],
    }));
    const getter = createConfiguredInteriorGetter(
      { MATTERPORT_SDK_KEY: "sdk-key" },
      { readSite },
    );
    expect(await getter("12:34")).toMatchObject({
      kind: "scan",
      modelId: "Abcdefghi12",
      showcaseParams: { sdkKey: "sdk-key" },
      provenance: { scope: "space" },
    });
    readSite.mockImplementationOnce(async () => ({
      ...(await readSite.mock.results[0]!.value),
      models: [
        {
          ...(await readSite.mock.results[0]!.value).models[0],
          displayApproved: false,
        },
      ],
    }));
    expect(await getter("12:34")).toMatchObject({ kind: "modeled" });
  });
  it("does not call a provider for unapproved/private mappings even with credentials", async () => {
    const { createConfiguredInteriorGetter } = await import("./runtime");
    const fetcher = vi.fn();
    const get = createConfiguredInteriorGetter(
      { MATTERPORT_API_TOKEN: "token:secret" },
      {
        fetch: fetcher,
        readSite: async () => ({
          siteId: "12:34",
          propertyId: "12",
          floorPlanUri: null,
          models: [
            {
              modelId: "Abcdefghi12",
              spaceId: null,
              hasExterior: null,
              displayApproved: true,
              isPublic: false,
              dimensions: null,
              source: {
                origin: "costar",
                provider: "costar",
                mode: "live",
                scope: "property",
                description: "Private scan",
                limitations: [],
              },
            },
          ],
        }),
      },
    );
    expect(await get("12:34")).toMatchObject({ kind: "modeled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
it("fetches dimensions read-only for the approved selected model without touching a database cache", async () => {
  const { createConfiguredInteriorGetter } = await import("./runtime");
  const { syntheticModelApiResponse } =
    await import("./__fixtures__/model-api");
  const wire = structuredClone(syntheticModelApiResponse);
  wire.data.model.id = "Abcdefghi12";
  const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(wire), { status: 200 }),
    ),
    database = vi.fn(async () => {
      throw new Error("No database writes permitted");
    });
  const get = createConfiguredInteriorGetter(
    { MATTERPORT_API_TOKEN: "token:secret" },
    {
      fetch: fetcher,
      database,
      readSite: async () => ({
        siteId: "12:34",
        propertyId: "12",
        floorPlanUri: null,
        models: [
          {
            modelId: "Abcdefghi12",
            spaceId: null,
            hasExterior: null,
            displayApproved: true,
            isPublic: true,
            dimensions: null,
            source: {
              origin: "costar",
              provider: "costar",
              mode: "live",
              scope: "property",
              description: "Approved parent property",
              limitations: [],
            },
          },
        ],
      }),
    },
  );
  expect(await get("12:34")).toMatchObject({
    kind: "scan",
    dimensions: { provenance: { scope: "property" } },
  });
  expect(database).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(fetcher.mock.calls[0]![1]!.body as string).variables,
  ).toEqual({ modelId: "Abcdefghi12" });
});
