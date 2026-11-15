import "server-only";
import { sql } from "drizzle-orm";
import type { AssumedValue } from "@/lib/contracts";
import { SiteInventorySchema } from "@/lib/contracts/sites";
import { searchSites } from "@/lib/data/sites";
import {
  readCatchment,
  type CatchmentExecutor,
} from "@/lib/data/catchment-repository";
import { getDb } from "@/lib/db/client";
import {
  createJevClientFromEnv,
  jevBundleOrdersFromEnv,
  type JevClient,
} from "@/lib/panel/jev-client";
import { createPostgresJevCache } from "@/lib/panel/cache-postgres";
import {
  assembleEvaluation,
  type AssembleEvaluationInput,
  type AssemblyCatchment,
  type AssemblyDependencies,
  type PanelDeadline,
} from "./assemble";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value)) throw new Error("Invalid database response");
  return value as Row[];
};
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const location = (row: Row) => {
  const lat = Number(row.latitude),
    lng = Number(row.longitude);
  return row.latitude !== null &&
    row.longitude !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? { lat, lng }
    : undefined;
};

/** Adapter is injectable for the gated local PostGIS test; normal calls use the configured DB. */
export function createPostgresAssemblyDependencies(
  db: CatchmentExecutor,
  projectId: string,
  jevClient?: JevClient,
): AssemblyDependencies {
  return {
    ...(jevClient
      ? {
          jev: {
            client: jevClient,
            // HAC-131: one request per persona x site instead of one per order. Opt-in
            // (JEV_BUNDLE_ORDERS) until validated against live Jev.
            bundleOrders: jevBundleOrdersFromEnv(),
            cache: createPostgresJevCache(
              db,
              projectId,
              jevClient.modelVersion,
            ),
          },
        }
      : {}),
    async searchSites(profile, candidateIds) {
      // Filter before the shortlist limit, so requested candidates beyond the global top eight remain addressable.
      const wanted = sql.join(
        candidateIds.map((id) => sql`${id}`),
        sql`, `,
      );
      const properties = rows(
        await db.execute(sql`SELECT p.id,p.city,p.latitude,p.longitude,p.source,
        jsonb_build_object('buildingName',p.data->'buildingName','primaryAddress',p.data->'primaryAddress',
          'propertyRetail',jsonb_build_object('frontage',p.data->'propertyRetail'->'frontage'),
          'parking',p.data->'parking','parkingRatio',p.data->'parkingRatio','provenance',p.data->'provenance') AS data
        FROM costar_properties p WHERE p.id IN (SELECT property_id FROM costar_spaces WHERE id IN (${wanted}))`),
      );
      const spaces = rows(
        await db.execute(sql`SELECT id,listing_id AS "listingId",property_id AS "propertyId",active,retail,size_sq_ft AS "sizeSqFt",source,
        jsonb_build_object('spaceUse',data->'spaceUse','position',data->'position','floor',data->'floor',
          'askingRentUsdPerSfYearLow',data->'askingRentUsdPerSfYearLow','askingRentUsdPerSfYearHigh',data->'askingRentUsdPerSfYearHigh',
          'serviceTypeName',data->'serviceTypeName','provenance',data->'provenance') AS data
        FROM costar_spaces WHERE id IN (${wanted})`),
      );
      const inventory = SiteInventorySchema.parse({
        properties,
        spaces,
        tenancies: [],
        synthetic: false,
      });
      const result = searchSites({ profile, limit: 8 }, inventory);
      const frontageFt: Record<string, AssumedValue> = {};
      for (const entry of result.candidates) {
        const property = inventory.properties.find(
          (p) => p.id === entry.propertyId,
        );
        const frontages = object(property?.data.propertyRetail).frontage;
        const values = (Array.isArray(frontages) ? frontages : [])
          .map((f) => object(f).frontageInFeet)
          .filter(
            (v): v is number =>
              typeof v === "number" && Number.isFinite(v) && v > 0,
          );
        if (values.length)
          frontageFt[entry.candidate.id] = {
            value: Math.max(...values),
            unit: "feet",
            origin: "costar",
            evidenceIds: entry.candidate.features.frontage.evidenceIds,
          };
      }
      return { result, frontageFt };
    },
    async getCatchment(siteId, profile) {
      if (profile.category === "unsupported")
        throw new Error("Unsupported category");
      const response = await readCatchment(
        db,
        siteId,
        {
          projectId: profile.projectId,
          category: profile.category,
          radiusMeters: 1000,
        },
        "default",
      );
      const locations: NonNullable<AssemblyCatchment["locations"]> = {
        blockGroups: {},
        workers: {},
        competitors: {},
      };
      const bgs = response.residents.blockGroups.map((bg) => bg.geoid);
      if (bgs.length)
        for (const row of rows(
          await db.execute(sql`SELECT geoid,ST_Y(ST_PointOnSurface(geom)) AS latitude,ST_X(ST_PointOnSurface(geom)) AS longitude
        FROM public_block_groups WHERE geoid IN (${sql.join(
          bgs.map((id) => sql`${id}`),
          sql`, `,
        )})`),
        )) {
          const point = location(row);
          if (point) locations.blockGroups![String(row.geoid)] = point;
        }
      const workers = response.workers.blocks.map((w) => w.geoid);
      if (workers.length)
        for (const row of rows(
          await db.execute(sql`SELECT geoid,ST_Y(point) AS latitude,ST_X(point) AS longitude,
            data->'monthlyEarningsBands' AS earnings,data->'ageBands' AS ages FROM public_jobs
        WHERE geoid IN (${sql.join(
          workers.map((id) => sql`${id}`),
          sql`, `,
        )})`),
        )) {
          const point = location(row);
          if (point) {
            const readBands = <K extends string>(
              raw: unknown,
              keys: Record<K, string>,
            ): Record<K, number> | undefined => {
              const values = object(raw);
              const entries = Object.entries(keys).map(
                ([key, field]) => [key, values[field as string]] as const,
              );
              if (
                entries.some(
                  ([, value]) =>
                    typeof value !== "number" ||
                    !Number.isFinite(value) ||
                    value < 0,
                )
              )
                return undefined;
              const mapped = Object.fromEntries(entries) as Record<K, number>;
              return Object.values<number>(mapped).reduce((a, b) => a + b, 0) >
                0
                ? mapped
                : undefined;
            };
            locations.workers![String(row.geoid)] = {
              ...point,
              earnings: readBands(row.earnings, {
                low: "1250-or-less",
                mid: "1251-3333",
                high: "over-3333",
              }),
              ages: readBands(row.ages, {
                under30: "29-and-under",
                age30to54: "30-54",
                over55: "55+",
              }),
            };
          }
        }
      const sources = [
        ...new Set(response.competitors.flatMap((c) => c.sourceIds)),
      ];
      const tenancies = sources
        .filter((id) => id.startsWith("costar:costar_tenant_"))
        .map((id) => id.slice("costar:costar_tenant_".length));
      const places = sources
        .filter((id) => id.startsWith("public:overture_"))
        .map((id) => id.slice("public:overture_".length));
      if (tenancies.length)
        for (const row of rows(
          await db.execute(sql`SELECT t.id,p.latitude,p.longitude FROM costar_tenancies t
        JOIN costar_properties p ON p.id=t.property_id WHERE t.id IN (${sql.join(
          tenancies.map((id) => sql`${id}`),
          sql`, `,
        )})`),
        )) {
          const point = location(row);
          if (point)
            locations.competitors![`costar:costar_tenant_${row.id}`] = {
              ...point,
              origin: "costar",
            };
        }
      if (places.length)
        for (const row of rows(
          await db.execute(sql`SELECT id,ST_Y(point) AS latitude,ST_X(point) AS longitude FROM public_places
        WHERE id IN (${sql.join(
          places.map((id) => sql`${id}`),
          sql`, `,
        )})`),
        )) {
          const point = location(row);
          if (point)
            locations.competitors![`public:overture_${row.id}`] = {
              ...point,
              origin: "public",
            };
        }
      return { response, locations };
    },
  };
}

export async function assemblePostgresEvaluation(
  input: AssembleEvaluationInput,
  panelDeadline: PanelDeadline = {},
) {
  const key = process.env.JEV_API_KEY?.trim();
  // Explicit opt-in only: the new shortcut defaults to Huff and cannot silently incur panel calls.
  const client =
    input.demandSource === "jev" && key ? createJevClientFromEnv() : undefined;
  return assembleEvaluation(
    input,
    createPostgresAssemblyDependencies(getDb(), input.projectId, client),
    panelDeadline,
  );
}
