import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  copilotThreads,
  copilotThreadEvents,
  copilotThreadCommits,
} from "@/lib/db/schema";

const id = z.string().min(1).max(512);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const json = z.json();
const object = z.record(z.string(), json);
const messageSchema = z.object({
  id,
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  turnId: id.optional(),
  createdAt: z.string().datetime().optional(),
  metadata: object.optional(),
});
const toolSchema = z.object({
  id,
  turnId: id,
  name: id,
  input: json,
  status: z.enum(["pending", "running", "completed", "failed"]),
  output: json.optional(),
  error: z.string().optional(),
});
const todoSchema = z.object({
  id,
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});
const turnSchema = z.object({
  id,
  status: z.enum([
    "pending",
    "running",
    "interrupted",
    "completed",
    "failed",
    "limited",
  ]),
  context: object.optional(),
  findings: z.array(z.string()).optional(),
  toolCalls: amount.optional(),
  startedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
});
const stateSchema = z.object({
  messages: z.array(messageSchema),
  toolCalls: z.array(toolSchema),
  todos: z.array(todoSchema),
  turn: turnSchema.nullable(),
  checkpoint: object.nullable(),
});
const eventSchema = z.object({ type: id, payload: json });
const mutationSchema = stateSchema
  .partial()
  .extend({
    idempotencyKey: id,
    events: z.array(eventSchema).optional(),
    costMicrousd: amount.optional(),
  })
  .strict();

export type StoredMessage = z.infer<typeof messageSchema>;
export type StoredToolCall = z.infer<typeof toolSchema>;
export type StoredTodo = z.infer<typeof todoSchema>;
export type StoredTurn = z.infer<typeof turnSchema>;
export type ThreadMutation = z.infer<typeof mutationSchema>;
export type ThreadSnapshot = z.infer<typeof stateSchema> & {
  projectId: string;
  revision: number;
  nextEventSeq: number;
  costMicrousd: number;
  costCapMicrousd: number;
  createdAt: string;
  updatedAt: string;
};
export type StoredThreadEvent = z.infer<typeof eventSchema> & {
  projectId: string;
  seq: number;
  createdAt: string;
};
export interface ThreadStore {
  load(projectId: string): Promise<ThreadSnapshot | null>;
  ensure(projectId: string, costCapMicrousd?: number): Promise<ThreadSnapshot>;
  commit(
    projectId: string,
    expectedRevision: number,
    mutation: ThreadMutation,
  ): Promise<ThreadSnapshot>;
  events(projectId: string, afterSeq?: number): Promise<StoredThreadEvent[]>;
}
export class ThreadStoreError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "conflict"
      | "replay_conflict"
      | "cost_limit"
      | "tool_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ThreadStoreError";
  }
}

const emptyState = () => ({
  messages: [],
  toolCalls: [],
  todos: [],
  turn: null,
  checkpoint: null,
});
const snapshot = (row: typeof copilotThreads.$inferSelect): ThreadSnapshot => ({
  ...stateSchema.parse(row.state),
  projectId: row.projectId,
  revision: row.revision,
  nextEventSeq: row.nextEventSeq,
  costMicrousd: row.costMicrousd,
  costCapMicrousd: row.costCapMicrousd,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// JSONB changes object key order. Canonicalize before hashing or comparing replays.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function upsert<T extends { id: string }>(previous: T[], updates: T[]): T[] {
  const result = new Map(previous.map((item) => [item.id, item]));
  for (const item of updates) result.set(item.id, item);
  return [...result.values()];
}

/**
 * Lazy Postgres adapter. Each commit locks the project row and atomically saves
 * state, event sequence, incremental cost and a replay receipt. No model calls.
 * Runtime must claim a turn/tool via CAS BEFORE executing external work, and use
 * the stored tool id as the external service's idempotency key for crash recovery.
 */
export function createPostgresThreadStore(
  database: () => ReturnType<typeof getDb> = getDb,
): ThreadStore {
  return {
    async load(projectId) {
      id.parse(projectId);
      const [row] = await database()
        .select()
        .from(copilotThreads)
        .where(eq(copilotThreads.projectId, projectId));
      return row ? snapshot(row) : null;
    },
    async ensure(projectId, costCapMicrousd = 5_000_000) {
      id.parse(projectId);
      amount.parse(costCapMicrousd);
      try {
        // Never overwrite an existing cap, thread, or spent amount on reload.
        await database()
          .insert(copilotThreads)
          .values({ projectId, costCapMicrousd, state: emptyState() })
          .onConflictDoNothing();
      } catch (error) {
        const code =
          (error as { cause?: { code?: string }; code?: string }).cause?.code ??
          (error as { code?: string }).code;
        if (code === "23503")
          throw new ThreadStoreError("not_found", "Project not found");
        throw error;
      }
      const thread = await this.load(projectId);
      if (!thread) throw new ThreadStoreError("not_found", "Thread not found");
      return thread;
    },
    async commit(projectId, expectedRevision, input) {
      id.parse(projectId);
      amount.parse(expectedRevision);
      const mutation = mutationSchema.parse(input);
      const hash = createHash("sha256")
        .update(canonical(mutation))
        .digest("hex");
      return database().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(copilotThreads)
          .where(eq(copilotThreads.projectId, projectId))
          .for("update");
        if (!row) throw new ThreadStoreError("not_found", "Thread not found");
        const [receipt] = await tx
          .select()
          .from(copilotThreadCommits)
          .where(
            and(
              eq(copilotThreadCommits.projectId, projectId),
              eq(copilotThreadCommits.idempotencyKey, mutation.idempotencyKey),
            ),
          );
        if (receipt) {
          if (receipt.inputHash !== hash)
            throw new ThreadStoreError(
              "replay_conflict",
              "Idempotency key already used for another mutation",
            );
          return snapshot(row);
        }
        if (row.revision !== expectedRevision)
          throw new ThreadStoreError("conflict", "Thread revision changed");
        const costMicrousd = row.costMicrousd + (mutation.costMicrousd ?? 0);
        if (
          !Number.isSafeInteger(costMicrousd) ||
          costMicrousd > row.costCapMicrousd
        )
          throw new ThreadStoreError("cost_limit", "Project cost cap reached");
        const previous = stateSchema.parse(row.state);
        for (const tool of mutation.toolCalls ?? []) {
          const existing = previous.toolCalls.find(
            (item) => item.id === tool.id,
          );
          if (
            existing &&
            (existing.turnId !== tool.turnId ||
              existing.name !== tool.name ||
              canonical(existing.input) !== canonical(tool.input) ||
              (existing.status === "completed" &&
                canonical(existing) !== canonical(tool)))
          ) {
            throw new ThreadStoreError(
              "tool_conflict",
              "Completed tool or tool identity cannot change",
            );
          }
        }
        const state = {
          messages: upsert(previous.messages, mutation.messages ?? []),
          toolCalls: upsert(previous.toolCalls, mutation.toolCalls ?? []),
          todos: mutation.todos ?? previous.todos,
          turn: mutation.turn === undefined ? previous.turn : mutation.turn,
          checkpoint:
            mutation.checkpoint === undefined
              ? previous.checkpoint
              : mutation.checkpoint,
        };
        const events = mutation.events ?? [];
        if (events.length)
          await tx.insert(copilotThreadEvents).values(
            events.map((event, index) => ({
              projectId,
              seq: row.nextEventSeq + index,
              type: event.type,
              // Keep JSON null distinct from SQL NULL.
              payload: sql`${JSON.stringify(event.payload)}::jsonb`,
            })),
          );
        await tx.insert(copilotThreadCommits).values({
          projectId,
          idempotencyKey: mutation.idempotencyKey,
          inputHash: hash,
        });
        const [saved] = await tx
          .update(copilotThreads)
          .set({
            state,
            revision: row.revision + 1,
            nextEventSeq: row.nextEventSeq + events.length,
            costMicrousd,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(copilotThreads.projectId, projectId))
          .returning();
        return snapshot(saved);
      });
    },
    async events(projectId, afterSeq = 0) {
      id.parse(projectId);
      amount.parse(afterSeq);
      const rows = await database()
        .select()
        .from(copilotThreadEvents)
        .where(
          and(
            eq(copilotThreadEvents.projectId, projectId),
            gt(copilotThreadEvents.seq, afterSeq),
          ),
        )
        .orderBy(asc(copilotThreadEvents.seq));
      return rows.map((row) => ({
        ...row,
        payload: json.parse(row.payload),
        createdAt: row.createdAt.toISOString(),
      }));
    },
  };
}
