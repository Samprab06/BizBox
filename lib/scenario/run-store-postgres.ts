import "server-only";
import { and, eq, gte, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects, scenarioRuns, scenarios } from "@/lib/db/schema";
import { ScenarioRunError, type ScenarioExecution, type ScenarioExecutionStore } from "./run-store";

type Row = typeof scenarioRuns.$inferSelect;
function asExecution(row: Row): ScenarioExecution {
  if (!row.effectiveKey || !row.idempotencyKey) throw new ScenarioRunError("not_found", "Legacy run has no execution checkpoint");
  return {
    id: row.id, projectId: row.projectId, scenarioId: row.scenarioId,
    idempotencyKey: row.idempotencyKey, effectiveKey: row.effectiveKey,
    status: row.status, costUnits: row.costUnits, cached: row.cached,
    request: row.request, assembly: row.assembly, completed: row.completed,
    comparisonId: row.comparisonId, runIds: row.runIds,
    createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision,
  };
}
/** Project row locks serialize reservations only; no network/CPU work in transactions. */
export function createPostgresScenarioExecutionStore(database: typeof getDb = getDb): ScenarioExecutionStore {
  return {
    async reserve(input) {
      return database().transaction(async tx => {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update");
        if (!project) throw new ScenarioRunError("not_found", "Project not found");
        const [scenario] = await tx.select({ id: scenarios.id }).from(scenarios)
          .where(and(eq(scenarios.projectId, input.projectId), eq(scenarios.id, input.scenarioId)));
        if (!scenario) throw new ScenarioRunError("not_found", "Scenario not found");
        const [existing] = await tx.select().from(scenarioRuns).where(and(
          eq(scenarioRuns.projectId, input.projectId), eq(scenarioRuns.scenarioId, input.scenarioId),
          eq(scenarioRuns.idempotencyKey, input.idempotencyKey),
        )).limit(1);
        if (existing) {
          if (existing.effectiveKey !== input.effectiveKey) throw new ScenarioRunError("invalid", "Idempotency key belongs to different inputs");
          return { status: "reserved", execution: asExecution(existing) };
        }
        const [cached] = await tx.select().from(scenarioRuns).where(and(
          eq(scenarioRuns.projectId, input.projectId), eq(scenarioRuns.effectiveKey, input.effectiveKey),
          eq(scenarioRuns.status, "succeeded"),
        )).limit(1);
        if (!cached) {
          const [pending] = await tx.select({ id: scenarioRuns.id }).from(scenarioRuns).where(and(
            eq(scenarioRuns.projectId, input.projectId), eq(scenarioRuns.effectiveKey, input.effectiveKey),
            inArray(scenarioRuns.status, ["queued", "running"]),
          )).limit(1);
          if (pending) throw new ScenarioRunError("busy", "Equivalent scenario is already running");
        }
        const [usage] = await tx.select({ units: sql<number>`coalesce(sum(${scenarioRuns.costUnits}), 0)::int` })
          .from(scenarioRuns).where(and(eq(scenarioRuns.projectId, input.projectId), eq(scenarioRuns.cached, false),
            gte(scenarioRuns.createdAt, new Date(input.now.getTime() - 86_400_000))));
        const remainingUnits = Math.max(0, input.budgetUnits - (usage?.units ?? 0));
        if (!cached && input.costUnits > remainingUnits && !input.confirm)
          return { status: "needs_confirmation", costUnits: input.costUnits, remainingUnits };
        const [created] = await tx.insert(scenarioRuns).values({
          id: input.id, projectId: input.projectId, scenarioId: input.scenarioId,
          effectiveKey: input.effectiveKey, idempotencyKey: input.idempotencyKey,
          costUnits: cached ? 0 : input.costUnits, cached: !!cached,
          status: cached ? "succeeded" : "queued", comparisonId: cached?.comparisonId ?? null,
          runIds: cached?.runIds ?? [], createdAt: input.now, updatedAt: input.now,
        }).returning();
        return { status: "reserved", execution: asExecution(created) };
      });
    },
    async get(projectId, id) {
      const [row] = await database().select().from(scenarioRuns).where(and(eq(scenarioRuns.projectId, projectId), eq(scenarioRuns.id, id))).limit(1);
      return row ? asExecution(row) : null;
    },
    async acquire(projectId, id, token, now, leaseMs) {
      const [row] = await database().update(scenarioRuns).set({ leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs) })
        .where(and(eq(scenarioRuns.projectId, projectId), eq(scenarioRuns.id, id),
          inArray(scenarioRuns.status, ["queued", "running"]),
          or(isNull(scenarioRuns.leaseToken), lte(scenarioRuns.leaseExpiresAt, now)))).returning();
      return row ? asExecution(row) : null;
    },
    async save(execution, token, now) {
      const [row] = await database().update(scenarioRuns).set({
        status: execution.status, request: execution.request, assembly: execution.assembly,
        completed: execution.completed, comparisonId: execution.comparisonId, runIds: execution.runIds,
        revision: execution.revision + 1, updatedAt: now,
      }).where(and(eq(scenarioRuns.id, execution.id), eq(scenarioRuns.projectId, execution.projectId),
        eq(scenarioRuns.leaseToken, token), gt(scenarioRuns.leaseExpiresAt, now),
        eq(scenarioRuns.revision, execution.revision))).returning();
      if (!row) throw new ScenarioRunError("lease_lost", "Scenario execution ownership changed");
      return asExecution(row);
    },
    async release(projectId, id, token) {
      await database().update(scenarioRuns).set({ leaseToken: null, leaseExpiresAt: null })
        .where(and(eq(scenarioRuns.id, id), eq(scenarioRuns.projectId, projectId), eq(scenarioRuns.leaseToken, token)));
    },
  };
}
