import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { Layout } from "../contracts/layout";
import { projects } from "./schema";

/** Immutable snapshots. Site source IDs intentionally have no replaceable CoStar FK. */
export const layouts = pgTable(
  "layouts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: text("site_id").notNull(),
    parentId: text("parent_id"),
    data: jsonb("data").$type<Layout>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("layouts_project_id_id_unique").on(t.projectId, t.id),
    unique("layouts_project_site_id_unique").on(t.projectId, t.siteId, t.id),
    foreignKey({
      name: "layouts_scoped_parent_fk",
      columns: [t.projectId, t.siteId, t.parentId],
      foreignColumns: [t.projectId, t.siteId, t.id],
    }),
    index("layouts_parent_idx").on(t.projectId, t.siteId, t.parentId),
    check(
      "layouts_not_own_parent",
      sql`${t.parentId} is distinct from ${t.id}`,
    ),
    check(
      "layouts_identity_valid",
      sql`length(btrim(${t.id})) between 1 and 200 and length(btrim(${t.siteId})) between 1 and 200`,
    ),
    check(
      "layouts_data_identity",
      sql`jsonb_typeof(${t.data}) = 'object' and ${t.data} ?& array['layoutId', 'siteId', 'parentId'] and (${t.data}->>'layoutId') is not distinct from ${t.id} and (${t.data}->>'siteId') is not distinct from ${t.siteId} and (${t.data}->>'parentId') is not distinct from ${t.parentId}`,
    ),
  ],
);
