import { syntheticFloorPlanSvg } from "@/lib/interior/fixtures";

export async function GET(
  _request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  if ((await context.params).siteId !== "interior-fixture-floorplan")
    return new Response("Not found", { status: 404 });
  return new Response(syntheticFloorPlanSvg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
