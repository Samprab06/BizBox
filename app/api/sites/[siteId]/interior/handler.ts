import {
  InteriorResponseSchema,
  type InteriorResponse,
} from "@/lib/contracts/interior";
import { interiorFixtureIds } from "@/lib/interior/fixtures";
import { InteriorNotFoundError } from "@/lib/interior/service";

const headers = { "Cache-Control": "private, no-store" };
type Getter = (siteId: string) => Promise<InteriorResponse>;

export function createInteriorHandler(getter: Getter) {
  return async (
    request: Request,
    context: { params: Promise<{ siteId: string }> },
  ) => {
    // Next has already decoded the URL component. Residual percent escapes are
    // rejected rather than decoded a second time into an accepted identifier.
    const { siteId } = await context.params;
    if (
      siteId.length > 100 ||
      (!/^\d+:\d+$/.test(siteId) &&
        !interiorFixtureIds.some((id) => id === siteId))
    )
      return Response.json(
        { error: "Invalid site identifier" },
        { status: 400, headers },
      );
    if ([...new URL(request.url).searchParams].length)
      return Response.json(
        { error: "Unsupported interior query" },
        { status: 400, headers },
      );
    try {
      return Response.json(InteriorResponseSchema.parse(await getter(siteId)), {
        headers,
      });
    } catch (error) {
      if (error instanceof InteriorNotFoundError)
        return Response.json(
          { error: "Site not found" },
          { status: 404, headers },
        );
      return Response.json(
        { error: "Interior is temporarily unavailable" },
        { status: 503, headers },
      );
    }
  };
}
