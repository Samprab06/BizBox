import { describe, expect, it, vi } from "vitest";
import { syntheticHoustonFixture } from "@/fixtures/houston-coffee";
import { searchSites } from "@/lib/data/sites";
import { createDevelopmentSitesHandler } from "./development-proxy";

const origin = "https://hackprincetonweb.vercel.app";
const environment = () => ({
  NODE_ENV: "development",
  SITE_SEARCH_DEV_ORIGIN: origin,
});
const profile = { ...syntheticHoustonFixture.profile, synthetic: false };
const request = (body: unknown = { profile }, headers?: HeadersInit) =>
  new Request("http://localhost/api/sites", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
const source = (dataset: string, recordId: string, field: string) => ({
  origin: "costar" as const,
  dataset,
  recordId,
  field,
});

// Invented rows exercise the actual-source protocol branch. They are not
// sponsor records or evidence that a live inventory/provider is available.
const inventory = () => ({
  synthetic: false,
  properties: [
    {
      id: "test-property",
      city: "Houston",
      latitude: 29.75,
      longitude: -95.38,
      data: {
        buildingName: "Invented protocol test property",
        primaryAddress: { streetNumber: "123", streetName: "Invented St" },
        propertyRetail: { frontage: [{ frontageInFeet: 25 }] },
      },
      source: source("commercial-property", "test-property", "id"),
    },
  ],
  spaces: [
    {
      id: "test-listing:test-space",
      propertyId: "test-property",
      listingId: "test-listing",
      active: true,
      retail: true,
      sizeSqFt: 1200,
      data: {
        floor: "Ground",
        spaceUse: "Retail",
        position: "Corner",
        serviceTypeName: "FullService",
        askingRentUsdPerSfYearLow: 24,
        askingRentUsdPerSfYearHigh: 24,
      },
      source: source("commercial-listing-summary", "test-listing", "id"),
    },
  ],
  tenancies: [],
});
const result = () => searchSites({ profile }, inventory());
const emptyInventory = () => ({ properties: [], spaces: [], tenancies: [] });

describe("development-only inventory read-through", () => {
  it("forwards only the canonical search body to the fixed endpoint and preserves the result", async () => {
    const expected = result();
    expect(expected.candidates).toHaveLength(1);
    const fetcher = vi.fn(async () => Response.json(expected));
    const loadInventory = vi.fn(async () => emptyInventory());
    const handler = createDevelopmentSitesHandler({
      loadInventory,
      environment,
      fetcher,
    });
    const response = await handler(
      request(
        { profile },
        { Cookie: "private-session", Authorization: "private-token" },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(expected);
    expect(loadInventory).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${origin}/api/sites`);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({
      "content-type": "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({ profile });
    expect(JSON.parse(String(init.body))).not.toHaveProperty(
      "nnnExpenseUsdPerSfYear",
    );
  });

  it("preserves an explicit NNN override instead of conflating it with omission", async () => {
    const fetcher = vi.fn(async () => Response.json(result()));
    const handler = createDevelopmentSitesHandler({
      loadInventory: async () => emptyInventory(),
      environment,
      fetcher,
    });
    await handler(request({ profile, nnnExpenseUsdPerSfYear: 10, limit: 1 }));
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      profile,
      nnnExpenseUsdPerSfYear: 10,
      limit: 1,
    });
  });

  it("bounds the upstream request to 15 seconds and cancels it with the caller", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const caller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Missing cancellation signal");
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          caller.abort();
        }),
    );
    try {
      const handler = createDevelopmentSitesHandler({
        loadInventory: vi.fn(),
        environment,
        fetcher,
      });
      const response = await handler(
        new Request(request(), { signal: caller.signal }),
      );
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("SITE_SEARCH_UNAVAILABLE");
    } finally {
      timeout.mockRestore();
    }
  });

  it.each([
    { ...environment(), NODE_ENV: "production" },
    { ...environment(), NODE_ENV: "test" },
    { ...environment(), NODE_ENV: undefined },
    { ...environment(), DATABASE_URL: "configured-private-database" },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: undefined },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: "" },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: "not-a-url" },
    {
      ...environment(),
      SITE_SEARCH_DEV_ORIGIN: "http://hackprincetonweb.vercel.app",
    },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: "https://untrusted.example" },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: `${origin}/api/sites` },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: `${origin}?anything=1` },
    { ...environment(), SITE_SEARCH_DEV_ORIGIN: `${origin}#fragment` },
    {
      ...environment(),
      SITE_SEARCH_DEV_ORIGIN:
        "https://user:password@hackprincetonweb.vercel.app",
    },
  ])(
    "retains the normal DB handler for ineligible configuration %#",
    async (env) => {
      const fetcher = vi.fn();
      const loadInventory = vi.fn(async () => emptyInventory());
      const handler = createDevelopmentSitesHandler({
        loadInventory,
        environment: () => env,
        fetcher,
      });
      const response = await handler(request());
      expect(response.status).toBe(200);
      expect((await response.json()).candidates).toEqual([]);
      expect(loadInventory).toHaveBeenCalledOnce();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { profile, limit: 9 },
    { profile, minSizeSqFt: 2000, maxSizeSqFt: 1000 },
    { profile, unapprovedField: true },
  ])(
    "validates the canonical request before any upstream request %#",
    async (body) => {
      const fetcher = vi.fn();
      const loadInventory = vi.fn();
      const handler = createDevelopmentSitesHandler({
        loadInventory,
        environment,
        fetcher,
      });
      const response = await handler(request(body));
      expect(response.status).toBe(422);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).code).toBe("INVALID_SITE_SEARCH");
      expect(fetcher).not.toHaveBeenCalled();
      expect(loadInventory).not.toHaveBeenCalled();
    },
  );

  it.each(["{invalid", JSON.stringify({ padding: "x".repeat(70_000) })])(
    "rejects malformed and oversized bodies before contacting the service",
    async (body) => {
      const fetcher = vi.fn();
      const handler = createDevelopmentSitesHandler({
        loadInventory: vi.fn(),
        environment,
        fetcher,
      });
      const response = await handler(
        new Request("http://localhost/api/sites", { method: "POST", body }),
      );
      expect(response.status).toBe(422);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("preserves a real empty result and filter diagnostics instead of substituting examples", async () => {
    const empty = searchSites({ profile }, emptyInventory());
    const handler = createDevelopmentSitesHandler({
      loadInventory: vi.fn(),
      environment,
      fetcher: vi.fn(async () => Response.json(empty)),
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(empty);
  });

  it.each([
    "wrong-project",
    "synthetic",
    "no-sources",
    "non-costar-source",
    "invalid-result",
  ])("fails closed for an unverified upstream result: %s", async (problem) => {
    const value = result();
    if (problem === "wrong-project")
      value.candidates[0]!.candidate.projectId = "another-project";
    if (problem === "synthetic")
      value.candidates[0]!.candidate.synthetic = true;
    if (problem === "no-sources") value.candidates[0]!.sources = [];
    if (problem === "non-costar-source")
      Object.assign(value.candidates[0]!.sources[0]!, { origin: "default" });
    const fetcher = vi.fn(async () =>
      Response.json(problem === "invalid-result" ? { candidates: [] } : value),
    );
    const handler = createDevelopmentSitesHandler({
      loadInventory: vi.fn(),
      environment,
      fetcher,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("SITE_SEARCH_UNAVAILABLE");
  });

  it.each([302, 429, 500, 503])(
    "does not expose an upstream %i response",
    async (status) => {
      const handler = createDevelopmentSitesHandler({
        loadInventory: vi.fn(),
        environment,
        fetcher: vi.fn(
          async () =>
            new Response("PRIVATE_UPSTREAM_DETAIL", {
              status,
              headers: { Location: "https://untrusted.example" },
            }),
        ),
      });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("PRIVATE_UPSTREAM_DETAIL");
    },
  );

  it.each(["network", "invalid-json"])(
    "sanitizes upstream %s failures",
    async (failure) => {
      const fetcher = vi.fn(async () => {
        if (failure === "invalid-json")
          return new Response("{broken", {
            headers: { "Content-Type": "application/json" },
          });
        throw new Error("PRIVATE_CONNECTION_DETAIL");
      });
      const handler = createDevelopmentSitesHandler({
        loadInventory: vi.fn(),
        environment,
        fetcher,
      });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("PRIVATE_CONNECTION_DETAIL");
    },
  );
});
