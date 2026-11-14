import { sql, type SQL } from "drizzle-orm";
import {
  SCENE_MAX_COMPETITORS,
  SCENE_MAX_NEARBY_PROPERTIES,
  SCENE_MAX_TENANTS_PER_PROPERTY,
  SceneGeometrySchema,
  SceneQuerySchema,
  type SceneGeometry,
  type SceneProvenance,
  type SceneQuery,
  type SceneResponse,
} from "../contracts/scene";
import type { AssumedValue } from "../contracts";

/**
 * HAC-76 (SIM-5): read-only projections for the neighborhood scene.
 *
 * Only authorized product fields leave Postgres. Raw CoStar `data` and `source` payloads,
 * provenance blobs and public-source payloads are never selected into the result: the
 * only values read out of `costar_properties.data` are the building name, address and
 * `numStoriesAboveGrade`, taken from the HAC-59 slim projection when it is present so the
 * ~0.5 MB property blob is not detoasted per request.
 */

export type SceneExecutor = { execute(query: SQL): PromiseLike<unknown> };
type Row = Record<string, unknown>;

export class SceneNotFoundError extends Error {}
export class SceneDataUnavailableError extends Error {}

/** About 22 m: invisible at city-view zoom, removes most block-group vertices. */
const SIMPLIFY_TOLERANCE_DEGREES = 0.0002;
const RING_SEGMENTS = 64;
const EARTH_RADIUS_METERS = 6371008.8;
const SITE_ID = /^\d+(?::\d+)?$/;

function rows(value: unknown): Row[] {
  if (!Array.isArray(value))
    throw new SceneDataUnavailableError("Invalid source response");
  return value as Row[];
}
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function required(value: unknown): number {
  const parsed = finite(value);
  if (parsed === null)
    throw new SceneDataUnavailableError("Missing source number");
  return parsed;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function stories(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? Math.round(parsed) : null;
}
const round1 = (value: number) => Math.round(value * 10) / 10;
/** Whole-number-or-null helper for census values: negatives are sentinels, not data. */
function census(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/** A closed geodesic circle (spherical earth) around a point, longitude first. */
export function circleRing(
  center: { longitude: number; latitude: number },
  radiusMeters: number,
  segments = RING_SEGMENTS,
): [number, number][] {
  const lat = (center.latitude * Math.PI) / 180;
  const lon = (center.longitude * Math.PI) / 180;
  const angular = radiusMeters / EARTH_RADIUS_METERS;
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const bearing = (2 * Math.PI * i) / segments;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angular) +
        Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat),
      );
    ring.push([
      Math.round(((pointLon * 180) / Math.PI) * 1e6) / 1e6,
      Math.round(((pointLat * 180) / Math.PI) * 1e6) / 1e6,
    ]);
  }
  ring.push([...ring[0]] as [number, number]);
  return ring;
}

function geometry(value: unknown): SceneGeometry {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new SceneDataUnavailableError("Invalid block-group geometry");
    }
  }
  const result = SceneGeometrySchema.safeParse(parsed);
  if (!result.success)
    throw new SceneDataUnavailableError("Invalid block-group geometry");
  return result.data;
}

type TenantRow = { name: string | null; industry: string | null };
function tenantsByProperty(tenantRows: Row[]) {
  const byProperty = new Map<string, TenantRow[]>();
  for (const row of tenantRows) {
    const key = String(row.property_id);
    const list = byProperty.get(key) ?? [];
    list.push({ name: text(row.name), industry: text(row.industry) });
    byProperty.set(key, list);
  }
  return byProperty;
}

function propertyFields(
  row: Row,
  tenants: Map<string, TenantRow[]>,
): {
  id: string;
  point: { longitude: number; latitude: number };
  propertyType: string | null;
  propertySubtype: string | null;
  retail: boolean;
  stories: number | null;
  tenants: TenantRow[];
  tenantCount: number;
} {
  const id = String(row.id);
  const all = tenants.get(id) ?? [];
  return {
    id,
    point: {
      longitude: required(row.longitude),
      latitude: required(row.latitude),
    },
    propertyType: text(row.property_type),
    propertySubtype: text(row.property_subtype),
    retail: row.retail === true,
    stories: stories(row.stories),
    tenants: all.slice(0, SCENE_MAX_TENANTS_PER_PROPERTY),
    tenantCount: all.length,
  };
}

function address(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Row;
  return (
    [
      "streetNumber",
      "streetDirection",
      "streetName",
      "streetType",
      "streetSuffix",
    ]
      .map((key) => text(record[key]))
      .filter(Boolean)
      .join(" ") || null
  );
}

function assumed(
  value: number | null,
  unit: string,
  evidenceId: string,
  reason: string,
): AssumedValue {
  return {
    value,
    unit,
    origin: "costar",
    evidenceIds: [evidenceId],
    ...(value === null ? { unknownReason: reason } : {}),
  };
}

/**
 * Read the scene in the caller's (read-only, repeatable-read) transaction.
 * The result is not yet validated: the route handler validates it against the contract.
 */
export async function readScene(
  db: SceneExecutor,
  siteId: string,
  query: SceneQuery,
  radiusOrigin: "founder" | "default",
): Promise<SceneResponse> {
  query = SceneQuerySchema.parse(query);
  if (!SITE_ID.test(siteId) || siteId.length > 100)
    throw new SceneNotFoundError("Unknown site identifier");

  // 1. Resolve the site: a CoStar property ID, or a marketed suite `listingId:spaceId`.
  let suiteRow: Row | undefined;
  let propertyId = siteId;
  if (siteId.includes(":")) {
    suiteRow = rows(
      await db.execute(sql`
        SELECT id, listing_id, property_id, size_sq_ft, source->>'dataset' AS dataset,
          data->>'askingRentUsdPerSfYearLow' AS rent_low,
          data->>'askingRentUsdPerSfYearHigh' AS rent_high
        FROM costar_spaces WHERE id=${siteId} LIMIT 1`),
    )[0];
    if (!suiteRow) throw new SceneNotFoundError("Site not found");
    propertyId = String(suiteRow.property_id);
  }
  const parentRow = rows(
    await db.execute(sql`
      SELECT p.id, p.city, p.property_type, p.property_subtype, p.retail,
        ST_X(p.point) AS longitude, ST_Y(p.point) AS latitude,
        p.source->>'dataset' AS dataset,
        CASE WHEN s.data ? 'buildingName' THEN s.data->'buildingName'
             ELSE p.data->'buildingName' END AS building_name,
        CASE WHEN s.data ? 'primaryAddress' THEN s.data->'primaryAddress'
             ELSE p.data->'primaryAddress' END AS primary_address,
        CASE WHEN s.data ? 'numStoriesAboveGrade' THEN s.data->'numStoriesAboveGrade'
             ELSE p.data->'numStoriesAboveGrade' END AS stories
      FROM costar_properties p
      LEFT JOIN costar_property_search s ON s.property_id=p.id
      WHERE p.id=${propertyId} LIMIT 1`),
  )[0];
  if (!parentRow) throw new SceneNotFoundError("Site not found");
  if (parentRow.longitude === null || parentRow.latitude === null)
    throw new SceneDataUnavailableError("Site geography is unavailable");
  const longitude = required(parentRow.longitude);
  const latitude = required(parentRow.latitude);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new SceneDataUnavailableError("Site geography is unavailable");

  const site = sql`ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326)::geography`;
  const radius = query.radiusMeters;
  const cap = SCENE_MAX_NEARBY_PROPERTIES + 1;
  const competitorCap = SCENE_MAX_COMPETITORS + 1;

  // 2. The spatial reads share one snapshot. Each ST_DWithin uses the geography GiST
  // index of its table (costar_properties_geog_idx, public_places_geog_idx,
  // public_block_groups_geog_idx).
  const [nearby, competitors, blockGroups, publicSources] = await Promise.all([
    db.execute(sql`
      SELECT p.id, p.property_type, p.property_subtype, p.retail,
        ST_X(p.point) AS longitude, ST_Y(p.point) AS latitude,
        ST_Distance(p.point::geography, ${site}) AS distance,
        CASE WHEN s.data ? 'numStoriesAboveGrade' THEN s.data->'numStoriesAboveGrade'
             ELSE p.data->'numStoriesAboveGrade' END AS stories
      FROM costar_properties p
      LEFT JOIN costar_property_search s ON s.property_id=p.id
      WHERE ST_DWithin(p.point::geography, ${site}, ${radius}) AND p.id<>${propertyId}
      ORDER BY distance, p.id LIMIT ${cap}`),
    db.execute(sql`
      SELECT id, name, category, ST_X(point) AS longitude, ST_Y(point) AS latitude,
        ST_Distance(point::geography, ${site}) AS distance
      FROM public_places
      WHERE category IS NOT NULL AND ST_DWithin(point::geography, ${site}, ${radius})
      ORDER BY distance, id LIMIT ${competitorCap}`),
    db.execute(sql`
      SELECT geoid, population, median_household_income,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${SIMPLIFY_TOLERANCE_DEGREES}), 5) AS geometry
      FROM public_block_groups
      WHERE ST_DWithin(geom::geography, ${site}, ${radius})
      ORDER BY geoid`),
    db.execute(sql`
      SELECT
        (SELECT source->>'dataset' FROM public_places LIMIT 1) AS places_dataset,
        (SELECT source->>'vintage' FROM public_places LIMIT 1) AS places_vintage,
        (SELECT source->>'dataset' FROM public_block_groups LIMIT 1) AS bg_dataset,
        (SELECT source->>'vintage' FROM public_block_groups LIMIT 1) AS bg_vintage`),
  ]);
  const nearbyRows = rows(nearby);
  const competitorRows = rows(competitors);
  const blockGroupRows = rows(blockGroups);
  const sources = rows(publicSources)[0] ?? {};

  // 3. Current tenants of the parent and the properties actually returned.
  const propertyRows = nearbyRows.slice(0, SCENE_MAX_NEARBY_PROPERTIES);
  const tenantIds = [propertyId, ...propertyRows.map((r) => String(r.id))];
  const tenantRows = rows(
    await db.execute(sql`
      SELECT t.property_id, t.data->>'tenantName' AS name, t.data->>'industry' AS industry
      FROM costar_tenancies t
      WHERE t.property_id IN (${sql.join(
        tenantIds.map((id) => sql`${id}`),
        sql`, `,
      )}) AND coalesce(t.data->>'current','true')<>'false'
      ORDER BY t.property_id, t.id`),
  );
  const tenants = tenantsByProperty(tenantRows);

  const costarDataset = text(parentRow.dataset) ?? "commercial-property";
  const provenance: SceneProvenance[] = [
    {
      id: "scene:site",
      layer: "site",
      origin: "costar",
      dataset: costarDataset,
      vintage: null,
      description:
        "Site point is the CoStar property point. CoStar gives a point, not a building footprint.",
      limitations: ["Approximate location; no footprint or entrance geometry."],
    },
    {
      id: "scene:parent",
      layer: "parentProperty",
      origin: "costar",
      dataset: costarDataset,
      vintage: null,
      description:
        "Parent building name, address, type, retail flag and stories (numStoriesAboveGrade).",
      limitations: [
        "Stories describe the whole building, not the marketed suite.",
      ],
    },
    {
      id: "scene:nearby",
      layer: "nearbyProperties",
      origin: "costar",
      dataset: costarDataset,
      vintage: null,
      description:
        "CoStar properties within the radius: point, type, subtype, retail flag, stories and current tenants' industry and name.",
      limitations: [
        "Limited to properties in the loaded CoStar kit; not every building nearby.",
        "Tenant industries are CoStar's broad groups.",
      ],
    },
    {
      id: "scene:competitors",
      layer: "competitors",
      origin: "public",
      dataset: text(sources.places_dataset) ?? "Overture Maps places",
      vintage: text(sources.places_vintage),
      description:
        "Open places in the service categories (coffee, quick food, salon, fitness) within the radius, nearest first.",
      limitations: [
        "Category comes from the import's service-category mapping; it does not prove direct competition.",
      ],
    },
    {
      id: "scene:block-groups",
      layer: "blockGroups",
      origin: "public",
      dataset: text(sources.bg_dataset) ?? "ACS 5-year detailed tables",
      vintage: text(sources.bg_vintage),
      description:
        "Census block groups touching the radius with ACS population and median household income; polygons are simplified for display.",
      limitations: [
        "Whole block groups are returned, not clipped to the radius.",
        "ACS estimates carry margins of error and a null median means suppressed.",
      ],
    },
    {
      id: "scene:rings",
      layer: "rings",
      origin: radiusOrigin,
      dataset: "Geodesic circle",
      vintage: null,
      description:
        radiusOrigin === "founder"
          ? "Catchment radius chosen by the caller."
          : "Default catchment radius.",
      limitations: ["A circular range, not a walking or driving isochrone."],
    },
  ];

  let suite: SceneResponse["suite"] = null;
  if (suiteRow) {
    const size = finite(suiteRow.size_sq_ft);
    const low = finite(suiteRow.rent_low);
    const high = finite(suiteRow.rent_high);
    provenance.splice(1, 0, {
      id: "scene:suite",
      layer: "suite",
      origin: "costar",
      dataset: text(suiteRow.dataset) ?? "commercial-listing-summary",
      vintage: null,
      description:
        "Marketed suite size and asking rent from the CoStar listing.",
      limitations: [
        "Asking rent is an advertised USD/SF/year rate, not a signed lease.",
      ],
    });
    suite = {
      id: String(suiteRow.id),
      listingId: String(suiteRow.listing_id),
      sizeSqFt: assumed(
        size !== null && size > 0 ? size : null,
        "SF",
        "scene:suite",
        "CoStar has no size for this suite",
      ),
      askingRentUsdPerSfYear: {
        low: assumed(
          low !== null && low > 0 ? low : null,
          "USD/SF/year",
          "scene:suite",
          "CoStar has no asking rent for this suite",
        ),
        high: assumed(
          high !== null && high > 0 ? high : null,
          "USD/SF/year",
          "scene:suite",
          "CoStar has no asking rent for this suite",
        ),
      },
    };
  }

  const rings: SceneResponse["rings"] = [
    ...[...query.ringMeters]
      .sort((a, b) => a - b)
      .map((meters) => ({
        kind: "inner" as const,
        radiusMeters: meters,
        origin: "founder" as const,
        ring: circleRing({ longitude, latitude }, meters),
      })),
    {
      kind: "catchment" as const,
      radiusMeters: radius,
      origin: radiusOrigin,
      ring: circleRing({ longitude, latitude }, radius),
    },
  ];

  return {
    siteId,
    radiusMeters: radius,
    radiusOrigin,
    site: {
      propertyId,
      city: text(parentRow.city),
      point: { longitude, latitude },
    },
    suite,
    parentProperty: {
      ...propertyFields(parentRow, tenants),
      name: text(parentRow.building_name),
      address: address(parentRow.primary_address),
      city: text(parentRow.city),
    },
    nearbyProperties: propertyRows.map((row) => ({
      ...propertyFields(row, tenants),
      distanceMeters: round1(required(row.distance)),
    })),
    competitors: competitorRows.slice(0, SCENE_MAX_COMPETITORS).map((row) => ({
      id: String(row.id),
      name: text(row.name),
      category: String(row.category),
      point: {
        longitude: required(row.longitude),
        latitude: required(row.latitude),
      },
      distanceMeters: round1(required(row.distance)),
    })),
    blockGroups: blockGroupRows.map((row) => ({
      geoid: String(row.geoid),
      population: census(row.population),
      medianHouseholdIncome: census(row.median_household_income),
      geometry: geometry(row.geometry),
    })),
    rings,
    truncated: {
      nearbyProperties: nearbyRows.length > SCENE_MAX_NEARBY_PROPERTIES,
      competitors: competitorRows.length > SCENE_MAX_COMPETITORS,
    },
    provenance,
  };
}

/** Orchestrator entry point; all parts share one consistent read-only snapshot. */
export async function getScene(
  siteId: string,
  query: SceneQuery,
  radiusOrigin: "founder" | "default",
) {
  const { getDb } = await import("../db/client");
  return getDb().transaction(
    (tx) => readScene(tx, siteId, query, radiusOrigin),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
