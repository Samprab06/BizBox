import "server-only";
import { resolveInterior } from "./service";
import { readInteriorSite } from "./repository";
import { createPostgresDimensionsProvider } from "./cache-postgres";
import type { MatterportModelClient } from "./model-api";
import type { getDb } from "../db/client";

export function createInteriorGetter(
  options: {
    allowLicensedAssets?: boolean;
    modelClient?: MatterportModelClient;
    sdkKey?: string;
    database?: () => Promise<ReturnType<typeof getDb>>;
  } = {},
) {
  const database =
    options.database ?? (async () => (await import("../db/client")).getDb());
  return async (siteId: string) =>
    resolveInterior(
      siteId,
      async (id) => {
        return readInteriorSite(await database(), id);
      },
      {
        // Deliberately closed. Neither query parameters, imported manifests nor the
        // presence of a token approve licensed display. HAC-14 must activate this in
        // a reviewed change after access and terms are established. Even then the
        // resolver serves a scan only when it is public/unlisted (HAC-137 check)
        // and display-approved; everything else gets the modeled fallback.
        allowLicensedAssets: options.allowLicensedAssets === true,
        sdkKey: options.sdkKey,
        dimensionsProvider: options.modelClient
          ? async (mapping) =>
              createPostgresDimensionsProvider(
                await database(),
                options.modelClient!,
              )(mapping)
          : undefined,
      },
    );
}

// The default route does not inspect credentials or construct an API client.
// HAC-14 activation must explicitly inject both approved access and model client.
export const getInterior = createInteriorGetter();
