import type { NextRequest } from "next/server";

const collection = "us-tx-houstonr2-2023";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;
  if (resource !== "tileset" && resource !== "tile") {
    return new Response(null, { status: 404 });
  }

  const key = process.env.VEXCEL_API_KEY?.trim();
  if (!key) return new Response("Vexcel is unavailable", { status: 503 });

  const upstream = new URL(`https://api.vexcelgroup.com/v2/3d/${resource}`);
  upstream.searchParams.set("collection", collection);
  const query = request.nextUrl.searchParams;
  for (const name of ["zoom", "tile-x", "tile-y"]) {
    const value = query.get(name);
    if (value === null) continue;
    if (!/^\d{1,8}$/.test(value)) return new Response(null, { status: 400 });
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
      return new Response("Vexcel could not serve this tile", {
        status: response.status,
      });
    }

    const headers = {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    };
    // Vexcel uses relative ./tileset and ./tile references. Serving the
    // same sibling paths keeps all child requests on this proxy.
    return new Response(response.body, { headers });
  } catch {
    return new Response("Vexcel request failed", { status: 502 });
  }
}
