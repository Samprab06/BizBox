import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  bigint,
  boolean,
  timestamp,
  jsonb,
  check,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type { JevAskResult } from "@/lib/panel/jev-client";
export const interiorJevGrants = pgTable(
  "interior_jev_grants",
  {
    grantId: text("grant_id").primaryKey(),
    limitMicrousd: bigint("limit_microusd", { mode: "number" }).notNull(),
    reservedMicrousd: bigint("reserved_microusd", { mode: "number" }).notNull(),
    handoffReceipt: text("handoff_receipt").notNull(),
    active: boolean("active").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("interior_jev_grant_limit", sql`${t.limitMicrousd}=1000000`),
    check(
      "interior_jev_grant_reserved",
      sql`${t.reservedMicrousd}>=26864 AND ${t.reservedMicrousd}<=${t.limitMicrousd}`,
    ),
    check(
      "interior_jev_grant_handoff",
      sql`${t.handoffReceipt} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
export const interiorJevReservations = pgTable(
  "interior_jev_reservations",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id")
      .notNull()
      .references(() => interiorJevGrants.grantId),
    projectId: text("project_id").notNull(),
    cacheKey: text("cache_key").notNull(),
    reservedMicrousd: bigint("reserved_microusd", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("interior_jev_reservation_positive", sql`${t.reservedMicrousd}>0`),
    index("interior_jev_reservations_grant_idx").on(t.grantId),
  ],
);
export const interiorJevPolicyCache = pgTable(
  "interior_jev_policy_cache",
  {
    projectId: text("project_id").notNull(),
    cacheKey: text("cache_key").notNull(),
    response: jsonb("response").$type<JevAskResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.cacheKey] })],
);
export const interiorJevPolicyClaims = pgTable(
  "interior_jev_policy_claims",
  {
    projectId: text("project_id").notNull(),
    cacheKey: text("cache_key").notNull(),
    owner: text("owner").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.cacheKey] }),
    index("interior_jev_claims_expiry_idx").on(t.expiresAt),
  ],
);
