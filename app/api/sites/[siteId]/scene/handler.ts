import { SceneQuerySchema, SceneResponseSchema } from "@/lib/contracts/scene";
import {
  SceneDataUnavailableError,
  SceneNotFoundError,
  getScene,
} from "@/lib/data/scene-repository";

type Getter = typeof getScene;

/**
 * The kit and public data are static between loads, so a successful scene is safe to share:
 * browsers keep it for a minute, shared caches for an hour and may serve a stale copy for a
 * day while revalidating. Errors are never cached.
 */
export const SCENE_CACHE_CONTROL =
  "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400";
const errorHeaders = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  Response.json({ error }, { status, headers: errorHeaders });

export function createSceneHandler(getter: Getter = getScene) {
  return async (
    request: Request,
    context: { params: Promise<{ siteId: string }> },
  ) => {
    let siteId: string;
    try {
      siteId = decodeURIComponent((await context.params).siteId);
    } catch {
      return fail("Invalid site identifier", 400);
    }
    if (!/^\d+(?::\d+)?$/.test(siteId) || siteId.length > 100)
      return fail("Invalid site identifier", 400);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      return fail("Repeated query parameter", 400);
    const query = SceneQuerySchema.safeParse(Object.fromEntries(params));
    if (!query.success) return fail("Invalid scene query", 400);
    try {
      const scene = await getter(
        siteId,
        query.data,
        params.has("radiusMeters") ? "founder" : "default",
      );
      // Validating the response is also the leak guard: every object is strict.
      return Response.json(SceneResponseSchema.parse(scene), {
        headers: { "Cache-Control": SCENE_CACHE_CONTROL },
      });
    } catch (error) {
      if (error instanceof SceneNotFoundError)
        return fail("Site not found", 404);
      if (error instanceof SceneDataUnavailableError)
        return fail("Scene source data is unavailable", 503);
      // Driver errors may contain source payloads or connection details.
      return fail("Scene is temporarily unavailable", 503);
    }
  };
}
