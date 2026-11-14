import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const collection = "us-tx-houstonr2-2023";

// Tiles are immutable per (collection, zoom, tile-x, tile-y) and carry no
// per-viewer data, so successful tile bytes are safe to share through the CDN.
// The CDN cache key is the full request URL: path (tile or tileset) plus the
// zoom, tile-x, tile-y and childAOI query values this route reads.
const TILE_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const NO_STORE = "no-store";

function uncached(body: BodyInit | null, status: number) {
  return new Response(body, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  if (resource !== "tileset" && resource !== "tile") {
    return uncached(null, 404);
  }

  const key = process.env.VEXCEL_API_KEY?.trim();
  if (!key) return uncached("Vexcel is unavailable", 503);

  const upstream = new URL(`https://api.vexcelgroup.com/v2/3d/${resource}`);
  upstream.searchParams.set("collection", collection);
  const query = request.nextUrl.searchParams;
  for (const name of ["zoom", "tile-x", "tile-y"]) {
    const value = query.get(name);
    if (value === null) continue;
    if (!/^\d{1,8}$/.test(value)) return uncached(null, 400);
    upstream.searchParams.set(name, value);
  }
  if (query.has("childAOI")) upstream.searchParams.set("childAOI", collection);
  if (resource === "tileset") upstream.searchParams.set("layer", "3d-cities");

  try {
    const response = await fetch(upstream, {
      headers: { "X-API-KEY": key },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return uncached("Vexcel could not serve this tile", response.status);
    }

    // Only a 200 with real tile data is shared. Other 2xx statuses (such as
    // 204 or 206) pass through uncached rather than risk caching an empty or
    // partial body for 30 days. Upstream headers are not forwarded except the
    // content type, so nothing user- or key-specific can ride along.
    const headers = {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control":
        response.status === 200 ? TILE_CACHE_CONTROL : NO_STORE,
    };
    // Vexcel uses relative ./tileset and ./tile references. Serving the
    // same sibling paths keeps all child requests on this proxy.
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return uncached("Vexcel request failed", 502);
  }
}
