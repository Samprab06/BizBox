import type { EvaluationRequest } from "@/lib/contracts/evaluation";
import type { ScenarioRunStatus } from "@/lib/contracts/scenario";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";
import type { SiteOutcome } from "@/lib/evaluation/evaluate";

export interface ScenarioExecution {
  id: string;
  projectId: string;
  scenarioId: string;
  idempotencyKey: string;
  effectiveKey: string;
  costUnits: number;
  cached: boolean;
  status: ScenarioRunStatus;
  request: EvaluationRequest | null;
  assembly: AssemblyMetadata | null;
  completed: Record<string, SiteOutcome>;
  comparisonId: string | null;
  runIds: string[];
  createdAt: Date;
  updatedAt: Date;
  revision: number;
}
export class ScenarioRunError extends Error {
  constructor(readonly code: "not_found" | "busy" | "invalid" | "lease_lost", message: string) {
    super(message);
    this.name = "ScenarioRunError";
  }
}
export type Reservation =
  | { status: "reserved"; execution: ScenarioExecution }
  | { status: "needs_confirmation"; costUnits: number; remainingUnits: number };
export interface ScenarioExecutionStore {
  /** Atomically lock the project, deduplicate, check cache and reserve 24h units. */
  reserve(input: {
    id: string; projectId: string; scenarioId: string; idempotencyKey: string;
    effectiveKey: string; costUnits: number; budgetUnits: number; confirm: boolean; now: Date;
  }): Promise<Reservation>;
  get(projectId: string, id: string): Promise<ScenarioExecution | null>;
  acquire(projectId: string, id: string, token: string, now: Date, leaseMs: number): Promise<ScenarioExecution | null>;
  save(execution: ScenarioExecution, token: string, now: Date): Promise<ScenarioExecution>;
  release(projectId: string, id: string, token: string): Promise<void>;
}
