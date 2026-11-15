import { sql, type SQL } from "drizzle-orm";
import {
  FloorPlanUriSchema,
  InteriorDiscoverySchema,
  InteriorDimensionsSchema,
  InteriorProvenanceSchema,
  MatterportModelIdSchema,
  ScanPlacementSchema,
} from "../contracts/interior";
import type { InteriorSite } from "./service";

type Executor = { execute(query: SQL): PromiseLike<unknown> };
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value))
    throw new Error("Interior source data unavailable");
  return value;
}

/** Select only authorized product projections; never detoast whole source rows. */
export async function readInteriorSite(
  db: Executor,
  siteId: string,
): Promise<InteriorSite | null> {
  const site = rows(
    await db.execute(sql`
    SELECT s.id, s.property_id, coalesce(s.data->'floorPlan'->>'attachmentUri', s.data->'floorPlan'->>'uri') AS floor_plan_uri,
    (SELECT coalesce(jsonb_agg(d), '[]'::jsonb) FROM (
      SELECT a.value->>'videoKey' AS "modelId", 'property' AS scope,
        'attachments.'||(a.ordinality-1)::text||'.videoKey' AS "sourceField"
      FROM costar_properties p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.data->'attachments')='array' THEN p.data->'attachments' ELSE '[]'::jsonb END) WITH ORDINALITY a(value,ordinality)
      WHERE p.id=s.property_id AND a.value->>'videoExternalReferenceType' IN ('36','234')
      UNION ALL
      SELECT a.value->>'videoKey', 'space', 'attachments.'||(a.ordinality-1)::text||'.videoKey'
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'attachments')='array' THEN s.data->'attachments' ELSE '[]'::jsonb END) WITH ORDINALITY a(value,ordinality)
      WHERE a.value->>'videoExternalReferenceType' IN ('36','234')
      UNION ALL
      SELECT a.data->>'matterportModelId','property',coalesce(a.source->>'field','normalized attachment')
      FROM costar_attachments a WHERE a.property_id=s.property_id AND a.data->>'matterportModelId' IS NOT NULL AND a.source->>'origin'='costar' AND a.source->>'dataset' IN ('commercial-property','commercial-listing-summary')
      ORDER BY scope DESC, "modelId"
      LIMIT 9
    ) d) AS discovered
    FROM costar_spaces s WHERE s.id=${siteId} LIMIT 1
  `),
  )[0];
  if (!site) return null;
  if (typeof site.id !== "string" || typeof site.property_id !== "string")
    throw new Error("Invalid interior site");
  const models = rows(
    await db.execute(sql`
    SELECT model_id, costar_space_id, has_exterior, display_approved, is_public, dimensions, placement, source
    FROM matterport_models
    WHERE costar_property_id=${site.property_id} AND (costar_space_id=${siteId} OR costar_space_id IS NULL)
    ORDER BY model_id
  `),
  );
  const floorPlan = FloorPlanUriSchema.safeParse(site.floor_plan_uri);
  return {
    siteId: site.id,
    trustedDiscovery: true,
    propertyId: site.property_id,
    floorPlanUri: floorPlan.success ? floorPlan.data : null,
    discovery: InteriorDiscoverySchema.parse({
      models: (Array.isArray(site.discovered) ? site.discovered : [])
        .filter(
          (raw): raw is Record<string, unknown> =>
            !!raw && typeof raw === "object",
        )
        .filter(
          (raw) =>
            MatterportModelIdSchema.safeParse(raw.modelId).success &&
            (raw.scope === "space" || raw.scope === "property") &&
            typeof raw.sourceField === "string",
        )
        .filter(
          (raw, index, all) =>
            all.findIndex(
              (other) =>
                other.modelId === raw.modelId && other.scope === raw.scope,
            ) === index,
        )
        .slice(0, 8)
        .map((raw) => {
          const approved = models.some(
            (m) =>
              m.model_id === raw.modelId &&
              m.display_approved === true &&
              m.is_public === true &&
              (raw.scope === "property"
                ? m.costar_space_id === null
                : m.costar_space_id === siteId),
          );
          return {
            ...raw,
            displayApproved: approved,
            reason: approved
              ? "Reviewed public registry mapping available"
              : "Source model found; current public verification required for automatic viewing",
          };
        }),
      truncated: Array.isArray(site.discovered) && site.discovered.length > 8,
      limitations: [
        "Discovery is bounded source metadata, not account-wide search or proof of SDK access, exact-suite geometry, calibration or Defurnish availability.",
        "Parent-property attachments do not identify the selected lease suite.",
      ],
    }),
    models: models.map((model) => ({
      modelId: MatterportModelIdSchema.parse(model.model_id),
      spaceId:
        typeof model.costar_space_id === "string"
          ? model.costar_space_id
          : null,
      hasExterior:
        typeof model.has_exterior === "boolean" ? model.has_exterior : null,
      displayApproved: model.display_approved === true,
      isPublic: typeof model.is_public === "boolean" ? model.is_public : null,
      dimensions:
        model.dimensions == null
          ? null
          : InteriorDimensionsSchema.parse(model.dimensions),
      placement:
        model.placement == null
          ? null
          : ScanPlacementSchema.parse(model.placement),
      source: InteriorProvenanceSchema.parse(model.source),
    })),
  };
}
