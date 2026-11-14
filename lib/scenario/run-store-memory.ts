import { ScenarioRunError, type Reservation, type ScenarioExecution, type ScenarioExecutionStore } from "./run-store";

/** In-memory adapter for deterministic offline evaluation and HTTP tests. */
export function createMemoryScenarioExecutionStore(): ScenarioExecutionStore {
  const rows = new Map<string, { execution: ScenarioExecution; token: string | null; until: number }>();
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    async reserve(input): Promise<Reservation> {
      const project = [...rows.values()].map(r => r.execution).filter(r => r.projectId === input.projectId);
      const existing = project.find(r => r.scenarioId === input.scenarioId && r.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.effectiveKey !== input.effectiveKey) throw new ScenarioRunError("invalid", "Idempotency key belongs to different inputs");
        return { status: "reserved", execution: clone(existing) };
      }
      const cached = project.find(r => r.effectiveKey === input.effectiveKey && r.status === "succeeded");
      if (!cached && project.some(r => r.effectiveKey === input.effectiveKey && (r.status === "queued" || r.status === "running")))
        throw new ScenarioRunError("busy", "Equivalent scenario is already running");
      const used = project.filter(r => !r.cached && r.createdAt.getTime() >= input.now.getTime() - 86_400_000)
        .reduce((sum, r) => sum + r.costUnits, 0);
      const remainingUnits = Math.max(0, input.budgetUnits - used);
      if (!cached && input.costUnits > remainingUnits && !input.confirm)
        return { status: "needs_confirmation", costUnits: input.costUnits, remainingUnits };
      const execution: ScenarioExecution = {
        id: input.id, projectId: input.projectId, scenarioId: input.scenarioId,
        idempotencyKey: input.idempotencyKey, effectiveKey: input.effectiveKey,
        costUnits: cached ? 0 : input.costUnits, cached: !!cached,
        status: cached ? "succeeded" : "queued", request: null, assembly: null, completed: {},
        comparisonId: cached?.comparisonId ?? null, runIds: cached?.runIds ?? [],
        createdAt: input.now, updatedAt: input.now, revision: 0,
      };
      rows.set(execution.id, { execution: clone(execution), token: null, until: 0 });
      return { status: "reserved", execution: clone(execution) };
    },
    async get(projectId, id) {
      const row = rows.get(id);
      return row?.execution.projectId === projectId ? clone(row.execution) : null;
    },
    async acquire(projectId, id, token, now, leaseMs) {
      const row = rows.get(id);
      if (!row || row.execution.projectId !== projectId || (row.token && row.until > now.getTime()) || row.execution.status === "succeeded" || row.execution.status === "failed") return null;
      row.token = token; row.until = now.getTime() + leaseMs;
      return clone(row.execution);
    },
    async save(execution, token, now) {
      const row = rows.get(execution.id);
      if (!row || row.execution.projectId !== execution.projectId || row.token !== token || row.until <= now.getTime() || row.execution.revision !== execution.revision)
        throw new ScenarioRunError("lease_lost", "Scenario execution ownership changed");
      row.execution = clone({ ...execution, revision: execution.revision + 1, updatedAt: now });
      return clone(row.execution);
    },
    async release(projectId, id, token) {
      const row = rows.get(id);
      if (row?.execution.projectId === projectId && row.token === token) { row.token = null; row.until = 0; }
    },
  };
}
