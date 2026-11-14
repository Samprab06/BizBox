import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const TILE_CACHE =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const SECRET = "test-vexcel-key-not-real";

function call(resource: string, search = "") {
  return GET(
    new NextRequest(`http://localhost/api/vexcel/3d/${resource}${search}`),
    { params: Promise.resolve({ resource }) },
  );
}

describe("vexcel 3d tile proxy caching", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.VEXCEL_API_KEY = SECRET;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    delete process.env.VEXCEL_API_KEY;
  });

  it("marks a successful tile response as CDN cacheable", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "model/gltf-binary", "Set-Cookie": "a=b" },
      }),
    );
    const res = await call("tile", "?zoom=16&tile-x=1&tile-y=2");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(TILE_CACHE);
    expect(res.headers.get("Content-Type")).toBe("model/gltf-binary");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("zoom=16");
    expect(String(url)).toContain("tile-x=1");
    expect(String(url)).toContain("tile-y=2");
    expect(String(url)).not.toContain(SECRET);
    expect(init.headers["X-API-KEY"]).toBe(SECRET);
  });

  it("never leaks the API key into a cached response", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await call("tileset");
    expect(res.headers.get("Cache-Control")).toBe(TILE_CACHE);
    expect([...res.headers.entries()].join("\n")).not.toContain(SECRET);
    expect(await res.text()).not.toContain(SECRET);
  });

  it("keeps upstream errors no-store with the upstream status", async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      fetchMock.mockResolvedValue(new Response("denied", { status }));
      const res = await call("tile", "?zoom=16&tile-x=1&tile-y=2");
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).not.toContain(SECRET);
    }
  });

  it("does not cache non-200 success statuses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await call("tile", "?zoom=16&tile-x=1&tile-y=2");
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps a fetch failure no-store", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const res = await call("tile", "?zoom=16&tile-x=1&tile-y=2");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps local rejections no-store without calling Vexcel", async () => {
    const unknown = await call("other");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe("no-store");

    const badQuery = await call("tile", "?zoom=abc");
    expect(badQuery.status).toBe(400);
    expect(badQuery.headers.get("Cache-Control")).toBe("no-store");

    delete process.env.VEXCEL_API_KEY;
    const noKey = await call("tile", "?zoom=16");
    expect(noKey.status).toBe(503);
    expect(noKey.headers.get("Cache-Control")).toBe("no-store");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
