import { sql, type SQL } from "drizzle-orm";
import {
  FloorPlanUriSchema,
  InteriorDimensionsSchema,
  InteriorProvenanceSchema,
  MatterportModelIdSchema,
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
    SELECT id, property_id, coalesce(data->'floorPlan'->>'attachmentUri', data->'floorPlan'->>'uri') AS floor_plan_uri
    FROM costar_spaces WHERE id=${siteId} LIMIT 1
  `),
  )[0];
  if (!site) return null;
  if (typeof site.id !== "string" || typeof site.property_id !== "string")
    throw new Error("Invalid interior site");
  const models = rows(
    await db.execute(sql`
    SELECT model_id, costar_space_id, has_exterior, display_approved, dimensions, source
    FROM matterport_models
    WHERE costar_property_id=${site.property_id} AND (costar_space_id=${siteId} OR costar_space_id IS NULL)
    ORDER BY model_id
  `),
  );
  const floorPlan = FloorPlanUriSchema.safeParse(site.floor_plan_uri);
  return {
    siteId: site.id,
    propertyId: site.property_id,
    floorPlanUri: floorPlan.success ? floorPlan.data : null,
    models: models.map((model) => ({
      modelId: MatterportModelIdSchema.parse(model.model_id),
      spaceId:
        typeof model.costar_space_id === "string"
          ? model.costar_space_id
          : null,
      hasExterior:
        typeof model.has_exterior === "boolean" ? model.has_exterior : null,
      displayApproved: model.display_approved === true,
      dimensions:
        model.dimensions == null
          ? null
          : InteriorDimensionsSchema.parse(model.dimensions),
      source: InteriorProvenanceSchema.parse(model.source),
    })),
  };
}
