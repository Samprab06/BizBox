import { z } from "zod";
import { AssumedValueSchema, OriginSchema } from "./index";

/**
 * HAC-76 (SIM-5): the neighborhood scene around one CoStar site.
 *
 * Every object is `.strict()`, so a raw CoStar `data` or `source` payload can never ride
 * along: only the fields named here are accepted. Origins follow the shared tagging
 * (`costar`, `public`, `founder`, `default`). Suite size and asking rent carry the shared
 * `AssumedValue` envelope; the evidence IDs of those values resolve against `provenance`.
 */

const Id = z.string().min(1);
export const SCENE_MAX_RADIUS_METERS = 5000;
export const SCENE_DEFAULT_RADIUS_METERS = 1000;
export const SCENE_MAX_RING_COUNT = 4;
/** Payload caps. When a cap bites, the nearest rows win and `truncated` says so. */
export const SCENE_MAX_NEARBY_PROPERTIES = 500;
export const SCENE_MAX_COMPETITORS = 1000;
export const SCENE_MAX_TENANTS_PER_PROPERTY = 25;

export const ScenePointSchema = z
  .object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();
export type ScenePoint = z.infer<typeof ScenePointSchema>;

const Position = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const LinearRing = z.array(Position).min(4);
const PolygonCoordinates = z.array(LinearRing).min(1);
/** A GeoJSON geometry, longitude first. Only polygons are used by the heat layer. */
export const SceneGeometrySchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("Polygon"), coordinates: PolygonCoordinates })
    .strict(),
  z
    .object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(PolygonCoordinates).min(1),
    })
    .strict(),
]);
export type SceneGeometry = z.infer<typeof SceneGeometrySchema>;

const repeatedRadii = (raw: unknown) =>
  typeof raw === "string"
    ? raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(Number)
    : raw;

/** Query string for `GET /api/sites/[siteId]/scene`. */
export const SceneQuerySchema = z
  .object({
    radiusMeters: z.coerce
      .number()
      .finite()
      .min(100)
      .max(SCENE_MAX_RADIUS_METERS)
      .default(SCENE_DEFAULT_RADIUS_METERS),
    /** Optional extra inner rings, comma separated (for example `400,800`). */
    ringMeters: z
      .preprocess(
        repeatedRadii,
        z
          .array(z.number().finite().min(100).max(SCENE_MAX_RADIUS_METERS))
          .max(SCENE_MAX_RING_COUNT),
      )
      .default([]),
  })
  .strict()
  .refine((q) => q.ringMeters.every((r) => r < q.radiusMeters), {
    path: ["ringMeters"],
    message: "Extra rings must be inside the catchment radius",
  });
export type SceneQuery = z.infer<typeof SceneQuerySchema>;
export type SceneQueryInput = z.input<typeof SceneQuerySchema>;

export const SceneProvenanceSchema = z
  .object({
    id: Id,
    layer: z.enum([
      "site",
      "suite",
      "parentProperty",
      "nearbyProperties",
      "competitors",
      "blockGroups",
      "rings",
    ]),
    origin: OriginSchema,
    dataset: z.string().min(1),
    vintage: z.string().min(1).nullable(),
    description: z.string().min(1),
    limitations: z.array(z.string().min(1)),
  })
  .strict();
export type SceneProvenance = z.infer<typeof SceneProvenanceSchema>;

const Tenant = z
  .object({ name: z.string().nullable(), industry: z.string().nullable() })
  .strict();
const Stories = z.number().int().positive().nullable();
const PropertyFields = {
  id: Id,
  point: ScenePointSchema,
  propertyType: z.string().nullable(),
  propertySubtype: z.string().nullable(),
  retail: z.boolean(),
  /** From CoStar `numStoriesAboveGrade`; null when CoStar has no usable value. */
  stories: Stories,
  tenants: z.array(Tenant).max(SCENE_MAX_TENANTS_PER_PROPERTY),
  tenantCount: z.number().int().nonnegative(),
};

export const SceneSuiteSchema = z
  .object({
    id: Id,
    listingId: Id,
    sizeSqFt: AssumedValueSchema,
    askingRentUsdPerSfYear: z
      .object({ low: AssumedValueSchema, high: AssumedValueSchema })
      .strict(),
  })
  .strict();

export const SceneResponseSchema = z
  .object({
    siteId: Id,
    radiusMeters: z.number().finite().positive(),
    radiusOrigin: z.enum(["founder", "default"]),
    site: z
      .object({
        propertyId: Id,
        city: z.string().nullable(),
        point: ScenePointSchema,
      })
      .strict(),
    /** Null when the site is a whole property rather than one marketed suite. */
    suite: SceneSuiteSchema.nullable(),
    parentProperty: z
      .object({
        ...PropertyFields,
        name: z.string().nullable(),
        address: z.string().nullable(),
        city: z.string().nullable(),
      })
      .strict(),
    nearbyProperties: z.array(
      z
        .object({
          ...PropertyFields,
          distanceMeters: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
    competitors: z.array(
      z
        .object({
          id: Id,
          name: z.string().nullable(),
          category: Id,
          point: ScenePointSchema,
          distanceMeters: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
    blockGroups: z.array(
      z
        .object({
          geoid: Id,
          population: z.number().finite().nonnegative().nullable(),
          medianHouseholdIncome: z.number().finite().nonnegative().nullable(),
          geometry: SceneGeometrySchema,
        })
        .strict(),
    ),
    rings: z
      .array(
        z
          .object({
            kind: z.enum(["catchment", "inner"]),
            radiusMeters: z.number().finite().positive(),
            origin: z.enum(["founder", "default"]),
            /** Geodesic circle around the site as a closed ring, longitude first. */
            ring: LinearRing,
          })
          .strict(),
      )
      .min(1),
    truncated: z
      .object({ nearbyProperties: z.boolean(), competitors: z.boolean() })
      .strict(),
    provenance: z.array(SceneProvenanceSchema).min(1),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const ids = new Set(scene.provenance.map((p) => p.id));
    if (ids.size !== scene.provenance.length)
      ctx.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "Provenance IDs must be unique",
      });
    const suite = scene.suite;
    if (!suite) return;
    for (const [path, value] of [
      [["suite", "sizeSqFt"], suite.sizeSqFt],
      [
        ["suite", "askingRentUsdPerSfYear", "low"],
        suite.askingRentUsdPerSfYear.low,
      ],
      [
        ["suite", "askingRentUsdPerSfYear", "high"],
        suite.askingRentUsdPerSfYear.high,
      ],
    ] as const) {
      if (value.evidenceIds.some((id) => !ids.has(id)))
        ctx.addIssue({
          code: "custom",
          path: [...path, "evidenceIds"],
          message: "Evidence must resolve to the provenance array",
        });
    }
  });
export type SceneResponse = z.infer<typeof SceneResponseSchema>;
