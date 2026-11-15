import "server-only";
import {
  checkInteriorPublic,
  createInteriorPublicChecker,
  type InteriorPublicChecker,
} from "./public-checker";
import {
  resolveInterior,
  type InteriorSiteReader,
  type InteriorDimensionsProvider,
} from "./service";
import { readInteriorSite } from "./repository";
import { createPostgresDimensionsProvider } from "./cache-postgres";
import {
  createMatterportModelClient,
  type MatterportModelClient,
} from "./model-api";
import type { getDb } from "../db/client";

export function createInteriorGetter(
  options: {
    allowLicensedAssets?: boolean;
    modelClient?: MatterportModelClient;
    sdkKey?: string;
    readSite?: InteriorSiteReader;
    dimensionsProvider?: InteriorDimensionsProvider;
    publicChecker?: InteriorPublicChecker;
    database?: () => Promise<ReturnType<typeof getDb>>;
  } = {},
) {
  const database =
    options.database ?? (async () => (await import("../db/client")).getDb());
  return async (siteId: string) =>
    resolveInterior(
      siteId,
      options.readSite ??
        (async (id) => readInteriorSite(await database(), id)),
      {
        // Viewing permits reviewed mappings and verified public canonical CoStar links.
        // Credentials and imported metadata never grant row-level approval.
        allowLicensedAssets: options.allowLicensedAssets === true,
        sdkKey: options.sdkKey,
        publicChecker: options.publicChecker,
        dimensionsProvider:
          options.dimensionsProvider ??
          (options.modelClient
            ? async (mapping) =>
                createPostgresDimensionsProvider(
                  await database(),
                  options.modelClient!,
                )(mapping)
            : undefined),
      },
    );
}

/**
 * User-authorized selected-candidate viewing includes verified public CoStar links.
 * Geometry eligibility remains separate; the resolver gates read-only dimensions.
 * No SQL cache writes, registry approval, asset unlock or provider mutation occurs.
 */
export function createConfiguredInteriorGetter(
  env: Record<string, string | undefined> = process.env,
  options: {
    readSite?: InteriorSiteReader;
    database?: () => Promise<ReturnType<typeof getDb>>;
    fetch?: typeof fetch;
  } = {},
) {
  return createInteriorGetter({
    allowLicensedAssets: true,
    sdkKey: env.MATTERPORT_SDK_KEY,
    publicChecker: options.fetch
      ? createInteriorPublicChecker(options.fetch)
      : checkInteriorPublic,
    readSite: options.readSite,
    database: options.database,
    dimensionsProvider: async (mapping) => {
      const token = env.MATTERPORT_API_TOKEN?.trim();
      if (!token) return;
      return createMatterportModelClient({
        token,
        approvedModelIds: [mapping.modelId],
        fetch: options.fetch,
      }).getDimensions(mapping.modelId);
    },
  });
}
export const getInterior = createConfiguredInteriorGetter();
