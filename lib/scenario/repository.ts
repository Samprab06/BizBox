import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  projectActiveScenario,
  scenarioRuns,
  scenarios,
} from "@/lib/db/schema";
import {
  ActiveScenarioSchema,
  ScenarioRunSchema,
  type ActiveScenario,
  type Scenario,
  type ScenarioRun,
  type ScenarioRunStatus,
} from "@/lib/contracts/scenario";
import {
  deriveScenario,
  parseScenario,
  scenarioLineage,
  type NewVersionMeta,
  type ScenarioChanges,
} from "./model";

export class ScenarioRepositoryError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "ScenarioRepositoryError";
  }
}

const pgCode = (error: unknown) =>
  (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
  (error as { code?: string })?.code;

async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = pgCode(error);
    if (code === "23503")
      throw new ScenarioRepositoryError(
        "not_found",
        "Project, profile version, parent scenario, scenario or comparison not found",
      );
    if (code === "23505")
      throw new ScenarioRepositoryError("conflict", "Scenario already exists");
    if (code === "23514")
      throw new ScenarioRepositoryError("invalid", "Scenario violates a constraint");
    throw error;
  }
}

type ScenarioRow = typeof scenarios.$inferSelect;
const asScenario = (row: ScenarioRow): Scenario =>
  parseScenario({
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    siteIds: row.siteIds,
    profileVersion: row.profileVersion,
    overrides: row.overrides,
    layoutId: row.layoutId,
    label: row.label,
    author: row.author,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString(),
  });

type RunRow = typeof scenarioRuns.$inferSelect;
const asRun = (row: RunRow): ScenarioRun =>
  ScenarioRunSchema.parse({
    id: row.id,
    projectId: row.projectId,
    scenarioId: row.scenarioId,
    comparisonId: row.comparisonId,
    runIds: row.runIds,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

export interface ScenarioRepository {
  /** Inserts a new version. There is no update: a change is `appendVersion`. */
  insert(scenario: Scenario): Promise<Scenario>;
  get(projectId: string, id: string): Promise<Scenario | null>;
  /** Every version in the project, oldest first. */
  list(projectId: string): Promise<Scenario[]>;
  /** Root-first chain ending at `id`. */
  lineage(projectId: string, id: string): Promise<Scenario[]>;
  /** Derives and inserts a child of `parentId`. */
  appendVersion(
    projectId: string,
    parentId: string,
    changes: ScenarioChanges,
    meta: NewVersionMeta,
  ): Promise<Scenario>;
  createRun(input: {
    id: string;
    projectId: string;
    scenarioId: string;
    now: Date;
  }): Promise<ScenarioRun>;
  /** Runs are mutable bookkeeping (status, comparison, run ids); scenarios are not. */
  updateRun(
    projectId: string,
    id: string,
    patch: {
      status?: ScenarioRunStatus;
      comparisonId?: string | null;
      runIds?: string[];
      now: Date;
    },
  ): Promise<ScenarioRun>;
  listRuns(projectId: string, scenarioId: string): Promise<ScenarioRun[]>;
  setActive(
    projectId: string,
    scenarioId: string,
    now: Date,
  ): Promise<ActiveScenario>;
  getActive(projectId: string): Promise<ActiveScenario | null>;
}

/** Lazy, server-only adapter. No database connection is opened at module import. */
export function createPostgresScenarioRepository(
  database: () => ReturnType<typeof getDb> = getDb,
): ScenarioRepository {
  const repo: ScenarioRepository = {
    async insert(input) {
      const s = parseScenario(input);
      const [row] = await mapped(() =>
        database()
          .insert(scenarios)
          .values({
            id: s.id,
            projectId: s.projectId,
            parentId: s.parentId,
            siteIds: s.siteIds,
            profileVersion: s.profileVersion,
            overrides: s.overrides,
            layoutId: s.layoutId,
            label: s.label,
            author: s.author,
            rationale: s.rationale,
            createdAt: new Date(s.createdAt),
          })
          .returning(),
      );
      return asScenario(row);
    },
    async get(projectId, id) {
      const [row] = await database()
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.projectId, projectId), eq(scenarios.id, id)))
        .limit(1);
      return row ? asScenario(row) : null;
    },
    async list(projectId) {
      const rows = await database()
        .select()
        .from(scenarios)
        .where(eq(scenarios.projectId, projectId))
        .orderBy(asc(scenarios.createdAt), asc(scenarios.id));
      return rows.map(asScenario);
    },
    async lineage(projectId, id) {
      const all = await repo.list(projectId);
      if (!all.some((s) => s.id === id))
        throw new ScenarioRepositoryError("not_found", "Scenario not found");
      return scenarioLineage(all, id);
    },
    async appendVersion(projectId, parentId, changes, meta) {
      const parent = await repo.get(projectId, parentId);
      if (!parent)
        throw new ScenarioRepositoryError("not_found", "Parent scenario not found");
      return repo.insert(deriveScenario(parent, changes, meta));
    },
    async createRun({ id, projectId, scenarioId, now }) {
      const [row] = await mapped(() =>
        database()
          .insert(scenarioRuns)
          .values({ id, projectId, scenarioId, createdAt: now, updatedAt: now })
          .returning(),
      );
      return asRun(row);
    },
    async updateRun(projectId, id, patch) {
      const [row] = await mapped(() =>
        database()
          .update(scenarioRuns)
          .set({
            ...(patch.status === undefined ? {} : { status: patch.status }),
            ...(patch.comparisonId === undefined
              ? {}
              : { comparisonId: patch.comparisonId }),
            ...(patch.runIds === undefined ? {} : { runIds: patch.runIds }),
            updatedAt: patch.now,
          })
          .where(
            and(eq(scenarioRuns.projectId, projectId), eq(scenarioRuns.id, id)),
          )
          .returning(),
      );
      if (!row)
        throw new ScenarioRepositoryError("not_found", "Scenario run not found");
      return asRun(row);
    },
    async listRuns(projectId, scenarioId) {
      const rows = await database()
        .select()
        .from(scenarioRuns)
        .where(
          and(
            eq(scenarioRuns.projectId, projectId),
            eq(scenarioRuns.scenarioId, scenarioId),
          ),
        )
        .orderBy(asc(scenarioRuns.createdAt), asc(scenarioRuns.id));
      return rows.map(asRun);
    },
    async setActive(projectId, scenarioId, now) {
      const [row] = await mapped(() =>
        database()
          .insert(projectActiveScenario)
          .values({ projectId, scenarioId, updatedAt: now })
          .onConflictDoUpdate({
            target: projectActiveScenario.projectId,
            set: { scenarioId, updatedAt: now },
          })
          .returning(),
      );
      return ActiveScenarioSchema.parse({
        projectId: row.projectId,
        scenarioId: row.scenarioId,
        updatedAt: row.updatedAt.toISOString(),
      });
    },
    async getActive(projectId) {
      const [row] = await database()
        .select()
        .from(projectActiveScenario)
        .where(eq(projectActiveScenario.projectId, projectId))
        .limit(1);
      return row
        ? ActiveScenarioSchema.parse({
            projectId: row.projectId,
            scenarioId: row.scenarioId,
            updatedAt: row.updatedAt.toISOString(),
          })
        : null;
    },
  };
  return repo;
}
