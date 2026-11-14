export * from "./costar-schema";
import { sql } from "drizzle-orm";
export * from "./public-schema";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  BehaviorTable,
  BusinessProfile,
  Evidence,
  LocationPlan,
  PersonaSet,
  SiteComparison,
  SiteRun,
} from "../contracts";
import type {
  InvestigationJob,
  InvestigationMilestone,
} from "../contracts/investigations";
import type { StoredEvaluation } from "../evaluation/store";
import type { ScenarioOverrides } from "../contracts/scenario";
import type { EvaluationRequest } from "../contracts/evaluation";
import type { AssemblyMetadata } from "../evaluation/assemble";
import type { SiteOutcome } from "../evaluation/evaluate";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const investigationStatus = pgEnum("investigation_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "interrupted",
]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<BusinessProfile>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("profiles_project_id_id_unique").on(t.projectId, t.id),
    unique("profiles_project_version_unique").on(t.projectId, t.version),
    check("profiles_version_positive", sql`${t.version} > 0`),
  ],
);

export const personaSets = pgTable(
  "persona_sets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    version: integer("version").notNull(),
    data: jsonb("data").$type<PersonaSet>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("persona_sets_project_id_id_unique").on(t.projectId, t.id),
    unique("persona_sets_profile_version_unique").on(
      t.projectId,
      t.profileId,
      t.version,
    ),
    foreignKey({
      name: "persona_sets_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("persona_sets_profile_idx").on(t.projectId, t.profileId),
    check("persona_sets_version_positive", sql`${t.version} > 0`),
  ],
);

export const behaviorTables = pgTable(
  "behavior_tables",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personaSetId: text("persona_set_id").notNull(),
    siteId: text("site_id").notNull(),
    modelVersion: text("model_version").notNull(),
    data: jsonb("data").$type<BehaviorTable>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("behavior_tables_project_id_id_unique").on(t.projectId, t.id),
    foreignKey({
      name: "behavior_tables_scoped_persona_set_fk",
      columns: [t.projectId, t.personaSetId],
      foreignColumns: [personaSets.projectId, personaSets.id],
    }).onDelete("cascade"),
    index("behavior_tables_persona_set_idx").on(t.projectId, t.personaSetId),
    index("behavior_tables_site_idx").on(t.projectId, t.siteId),
  ],
);

export const jevCache = pgTable(
  "jev_cache",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cacheKey: text("cache_key").notNull(),
    modelVersion: text("model_version").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("jev_cache_project_key_unique").on(t.projectId, t.cacheKey),
    index("jev_cache_expiry_idx").on(t.expiresAt),
  ],
);

export const comparisons = pgTable(
  "comparisons",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    data: jsonb("data").$type<SiteComparison>().notNull(),
    /** HAC-22: request (with cached behavior tables), full result and sensitivity, for exact reruns. */
    evaluation: jsonb("evaluation").$type<StoredEvaluation>(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("comparisons_project_id_id_unique").on(t.projectId, t.id),
    unique("comparisons_project_id_profile_unique").on(
      t.projectId,
      t.id,
      t.profileId,
    ),
    foreignKey({
      name: "comparisons_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("comparisons_profile_idx").on(t.projectId, t.profileId),
  ],
);

export const siteRuns = pgTable(
  "site_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    comparisonId: text("comparison_id"),
    siteId: text("site_id").notNull(),
    seed: integer("seed").notNull(),
    modelVersion: text("model_version").notNull(),
    data: jsonb("data").$type<Omit<SiteRun, "events">>().notNull(),
    events: jsonb("events").$type<SiteRun["events"]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "site_runs_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "site_runs_scoped_comparison_fk",
      columns: [t.projectId, t.comparisonId, t.profileId],
      foreignColumns: [
        comparisons.projectId,
        comparisons.id,
        comparisons.profileId,
      ],
    }).onDelete("cascade"),
    index("site_runs_profile_idx").on(t.projectId, t.profileId),
    index("site_runs_comparison_idx").on(
      t.projectId,
      t.comparisonId,
      t.profileId,
    ),
    index("site_runs_site_idx").on(t.projectId, t.siteId),
    check("site_runs_seed_nonnegative", sql`${t.seed} >= 0`),
  ],
);

export const investigations = pgTable(
  "investigations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    status: investigationStatus("status").notNull().default("queued"),
    question: text("question").notNull(),
    checkpoint: jsonb("checkpoint")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempt: integer("attempt").notNull().default(1),
    limits: jsonb("limits")
      .$type<InvestigationJob["limits"]>()
      .notNull()
      .default({ toolCalls: 25, pollCustomers: 3, evaluateSites: 3 }),
    counters: jsonb("counters")
      .$type<InvestigationJob["counters"]>()
      .notNull()
      .default({ toolCalls: 0, pollCustomers: 0, evaluateSites: 0 }),
    findings: jsonb("findings").$type<string[]>().notNull().default([]),
    lastAdvanceAt: timestamp("last_advance_at", { withTimezone: true }),
    reason: text("reason"),
    revision: integer("revision").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "investigations_scoped_profile_fk",
      columns: [t.projectId, t.profileId],
      foreignColumns: [profiles.projectId, profiles.id],
    }).onDelete("cascade"),
    index("investigations_profile_idx").on(t.projectId, t.profileId),
    index("investigations_queue_idx").on(t.projectId, t.status, t.createdAt),
    check("investigations_attempt_positive", sql`${t.attempt} > 0`),
    check("investigations_revision_nonnegative", sql`${t.revision} >= 0`),
  ],
);

export const investigationMilestones = pgTable(
  "investigation_milestones",
  {
    investigationId: text("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    seq: integer("seq").notNull(),
    tool: text("tool").notNull(),
    inputHash: text("input_hash").notNull(),
    summary: jsonb("summary")
      .$type<InvestigationMilestone["summary"]>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.investigationId, t.attempt, t.seq] }),
    check("investigation_milestones_attempt_positive", sql`${t.attempt} > 0`),
    check("investigation_milestones_seq_nonnegative", sql`${t.seq} >= 0`),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id").notNull(),
    comparisonId: text("comparison_id").notNull(),
    data: jsonb("data").$type<LocationPlan>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "plans_scoped_comparison_fk",
      columns: [t.projectId, t.comparisonId, t.profileId],
      foreignColumns: [
        comparisons.projectId,
        comparisons.id,
        comparisons.profileId,
      ],
    }).onDelete("cascade"),
    index("plans_comparison_idx").on(t.projectId, t.comparisonId, t.profileId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Evidence>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_project_idx").on(t.projectId)],
);

export const scenarioRunStatus = pgEnum("scenario_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/**
 * HAC-80: immutable scenario versions. Rows are insert-only (a trigger rejects
 * UPDATE); a change is a new row whose parent_id is the previous version.
 */
export const scenarios = pgTable(
  "scenarios",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    siteIds: jsonb("site_ids").$type<string[]>().notNull(),
    profileVersion: integer("profile_version").notNull(),
    overrides: jsonb("overrides").$type<ScenarioOverrides>().notNull(),
    /** AGT-7 layout. Deliberately not a foreign key until that table exists. */
    layoutId: text("layout_id"),
    label: text("label").notNull(),
    author: text("author").notNull(),
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("scenarios_project_id_id_unique").on(t.projectId, t.id),
    foreignKey({
      name: "scenarios_scoped_parent_fk",
      columns: [t.projectId, t.parentId],
      foreignColumns: [t.projectId, t.id],
    }),
    foreignKey({
      name: "scenarios_scoped_profile_version_fk",
      columns: [t.projectId, t.profileVersion],
      foreignColumns: [profiles.projectId, profiles.version],
    }),
    index("scenarios_project_idx").on(t.projectId, t.createdAt),
    index("scenarios_parent_idx").on(t.projectId, t.parentId),
    check("scenarios_author_valid", sql`${t.author} in ('founder', 'agent')`),
    check(
      "scenarios_agent_rationale",
      sql`${t.author} <> 'agent' or (${t.rationale} is not null and btrim(${t.rationale}) <> '')`,
    ),
    check(
      "scenarios_agent_never_founder",
      sql`${t.author} <> 'agent' or not jsonb_path_exists(${t.overrides}, '$.**.origin ? (@ == "founder")')`,
    ),
    check(
      "scenarios_site_ids_valid",
      sql`jsonb_typeof(${t.siteIds}) = 'array' and jsonb_array_length(${t.siteIds}) between 1 and 8`,
    ),
    check(
      "scenarios_not_own_parent",
      sql`${t.parentId} is distinct from ${t.id}`,
    ),
    check("scenarios_profile_version_positive", sql`${t.profileVersion} > 0`),
  ],
);

export const scenarioRuns = pgTable(
  "scenario_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").notNull(),
    /** The HAC-22 comparison this run produced; null until it exists. */
    comparisonId: text("comparison_id"),
    /** site_runs ids of the run. */
    runIds: jsonb("run_ids").$type<string[]>().notNull().default([]),
    status: scenarioRunStatus("status").notNull().default("queued"),
    /** HAC-81: atomic rolling-budget reservation and durable evaluator checkpoints. */
    costUnits: integer("cost_units").notNull().default(0),
    cached: boolean("cached").notNull().default(false),
    effectiveKey: text("effective_key"),
    idempotencyKey: text("idempotency_key"),
    request: jsonb("request").$type<EvaluationRequest>(),
    assembly: jsonb("assembly").$type<AssemblyMetadata>(),
    completed: jsonb("completed").$type<Record<string, SiteOutcome>>().notNull().default({}),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "scenario_runs_scoped_scenario_fk",
      columns: [t.projectId, t.scenarioId],
      foreignColumns: [scenarios.projectId, scenarios.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "scenario_runs_scoped_comparison_fk",
      columns: [t.projectId, t.comparisonId],
      foreignColumns: [comparisons.projectId, comparisons.id],
    }).onDelete("cascade"),
    index("scenario_runs_scenario_idx").on(t.projectId, t.scenarioId),
    index("scenario_runs_comparison_idx").on(t.projectId, t.comparisonId),
    unique("scenario_runs_idempotency_unique").on(t.projectId, t.scenarioId, t.idempotencyKey),
    index("scenario_runs_cache_idx").on(t.projectId, t.effectiveKey, t.status),
    index("scenario_runs_budget_idx").on(t.projectId, t.createdAt),
    check("scenario_runs_cost_valid", sql`${t.costUnits} >= 0 AND (NOT ${t.cached} OR ${t.costUnits} = 0)`),
    check("scenario_runs_revision_valid", sql`${t.revision} >= 0`),
    check("scenario_runs_lease_pair", sql`(${t.leaseToken} IS NULL) = (${t.leaseExpiresAt} IS NULL)`),
  ],
);

export const projectActiveScenario = pgTable(
  "project_active_scenario",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    scenarioId: text("scenario_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "project_active_scenario_scoped_scenario_fk",
      columns: [t.projectId, t.scenarioId],
      foreignColumns: [scenarios.projectId, scenarios.id],
    }).onDelete("cascade"),
  ],
);
