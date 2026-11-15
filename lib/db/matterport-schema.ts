import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  InteriorDimensions,
  InteriorProvenance,
  ScanPlacement,
} from "../contracts/interior";

// Source IDs intentionally have no CoStar FKs: source loaders replace those
// tables independently, and platform migrations run before source creation.
export const matterportModels = pgTable(
  "matterport_models",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull(),
    costarPropertyId: text("costar_property_id").notNull(),
    costarSpaceId: text("costar_space_id"),
    hasExterior: boolean("has_exterior"),
    source: jsonb("source").$type<InteriorProvenance>().notNull(),
    displayApproved: boolean("display_approved").notNull().default(false),
    dimensions: jsonb("dimensions").$type<InteriorDimensions>(),
    dimensionsRecordedAt: timestamp("dimensions_recorded_at", {
      withTimezone: true,
    }),
    // HAC-137: result of the public/unlisted embed check. NULL = never checked.
    // A public scan is still hidden until displayApproved is set by review.
    isPublic: boolean("is_public"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    // HAC-138: authored overlay placement for this scan. NULL = uncalibrated,
    // so the simulation overlay falls back to Modeled layout.
    placement: jsonb("placement").$type<ScanPlacement>(),
  },
  (t) => [
    unique("matterport_models_mapping_unique")
      .on(t.modelId, t.costarPropertyId, t.costarSpaceId)
      .nullsNotDistinct(),
    index("matterport_models_site_idx").on(t.costarPropertyId, t.costarSpaceId),
    check("matterport_models_id_valid", sql`${t.id} ~ '^[a-f0-9]{64}$'`),
    check(
      "matterport_models_model_valid",
      sql`${t.modelId} ~ '^[A-Za-z0-9]{11}$'`,
    ),
    check(
      "matterport_models_property_valid",
      sql`${t.costarPropertyId} ~ '^[0-9]+$'`,
    ),
    check(
      "matterport_models_space_valid",
      sql`${t.costarSpaceId} IS NULL OR ${t.costarSpaceId} ~ '^[0-9]+:[0-9]+$'`,
    ),
    check(
      "matterport_models_dimensions_pair",
      sql`(${t.dimensions} IS NULL) = (${t.dimensionsRecordedAt} IS NULL)`,
    ),
    check(
      "matterport_models_public_check_pair",
      sql`(${t.isPublic} IS NULL) = (${t.checkedAt} IS NULL)`,
    ),
  ],
);
