import { z } from "zod";
import {
  SiteSearchRequestSchema,
  SiteSearchResultSchema,
} from "@/lib/contracts/sites";
import { createSitesHandler, readBody } from "./handler";

const TRUSTED_ORIGIN = "https://hackprincetonweb.vercel.app";
const UPSTREAM_SEARCH = `${TRUSTED_ORIGIN}/api/sites`;

type SiteSearchEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  SITE_SEARCH_DEV_ORIGIN?: string;
};
type Dependencies = {
  loadInventory: () => Promise<unknown>;
  environment?: () => SiteSearchEnvironment;
  fetcher?: typeof fetch;
};

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () =>
  json(
    {
      code: "SITE_SEARCH_UNAVAILABLE",
      message: "Site inventory is temporarily unavailable. Please try again.",
      field_errors: {},
    },
    503,
  );

/**
 * Opt-in local read-through to this app's existing read-only inventory search.
 * Production, tests, configured databases and all other origins keep the DB path.
 */
export function createDevelopmentSitesHandler({
  loadInventory,
  environment = () => process.env,
  fetcher = fetch,
}: Dependencies) {
  const local = createSitesHandler({ loadInventory });
  return async function POST(request: Request) {
    const env = environment();
    if (
      env.NODE_ENV !== "development" ||
      env.DATABASE_URL?.trim() ||
      env.SITE_SEARCH_DEV_ORIGIN?.trim() !== TRUSTED_ORIGIN
    )
      return local(request);

    let input: z.input<typeof SiteSearchRequestSchema>;
    try {
      const raw = await readBody(request);
      SiteSearchRequestSchema.parse(raw);
      // Forward omission unchanged: injecting the schema's NNN default would
      // incorrectly turn a modeled default into a founder-supplied override.
      input = raw as z.input<typeof SiteSearchRequestSchema>;
    } catch (error) {
      const field_errors: Record<string, string[]> = {};
      if (error instanceof z.ZodError) {
        for (const issue of error.issues)
          field_errors[issue.path.join(".") || "_request"] = [
            "Invalid search value",
          ];
      } else field_errors._request = ["Invalid search request"];
      return json(
        {
          code: "INVALID_SITE_SEARCH",
          message: "Provide a valid profile and site filters.",
          field_errors,
        },
        422,
      );
    }

    try {
      if (request.signal.aborted) return unavailable();
      const response = await fetcher(UPSTREAM_SEARCH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) return unavailable();
      const result = SiteSearchResultSchema.parse(await response.json());
      if (
        result.candidates.some(
          ({ candidate, sources }) =>
            candidate.projectId !== input.profile.projectId ||
            candidate.synthetic ||
            sources.length === 0,
        )
      )
        return unavailable();
      return json(result, 200);
    } catch {
      return unavailable();
    }
  };
}
