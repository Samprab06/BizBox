import "server-only";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { investigations, investigationMilestones } from "@/lib/db/schema";
import {
  InvestigationJobSchema,
  InvestigationMilestoneSchema,
  type InvestigationJob,
  type InvestigationMilestone,
} from "@/lib/contracts/investigations";
import { InvestigationJobError, type InvestigationRepository } from "./jobs";

type Row = typeof investigations.$inferSelect;
const asJob = (row: Row): InvestigationJob =>
  InvestigationJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    profileId: row.profileId,
    question: row.question,
    status: row.status,
    attempt: row.attempt,
    limits: row.limits,
    counters: row.counters,
    findings: row.findings,
    lastAdvanceAt: row.lastAdvanceAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reason: row.reason,
    revision: row.revision,
  });
const mutableValues = (job: InvestigationJob) => ({
  status: job.status,
  attempt: job.attempt,
  limits: job.limits,
  counters: job.counters,
  findings: job.findings,
  reason: job.reason,
  lastAdvanceAt: job.lastAdvanceAt ? new Date(job.lastAdvanceAt) : null,
  updatedAt: new Date(job.updatedAt),
  revision: job.revision + 1,
});
const leaseLost = () =>
  new InvestigationJobError("lease_lost", "Investigation ownership changed");

/** Lazy, server-only adapter. No database connection is opened at module import. */
export function createPostgresInvestigationRepository(
  database: () => ReturnType<typeof getDb> = getDb,
): InvestigationRepository {
  return {
    async create(input) {
      const job = InvestigationJobSchema.parse(input);
      try {
        const [row] = await database()
          .insert(investigations)
          .values({
            id: job.id,
            projectId: job.projectId,
            profileId: job.profileId,
            question: job.question,
            ...mutableValues(job),
            revision: job.revision,
            createdAt: new Date(job.createdAt),
          })
          .returning();
        return asJob(row);
      } catch (error) {
        const code =
          (error as { cause?: { code?: string }; code?: string })?.cause
            ?.code ?? (error as { code?: string })?.code;
        if (code === "23503")
          throw new InvestigationJobError(
            "not_found",
            "Project or profile not found",
          );
        throw error;
      }
    },
    async load(id) {
      const [row] = await database()
        .select()
        .from(investigations)
        .where(eq(investigations.id, id))
        .limit(1);
      return row ? asJob(row) : null;
    },
    async listMilestones(id, attempt) {
      const rows = await database()
        .select()
        .from(investigationMilestones)
        .where(
          and(
            eq(investigationMilestones.investigationId, id),
            attempt === undefined
              ? undefined
              : eq(investigationMilestones.attempt, attempt),
          ),
        )
        .orderBy(
          asc(investigationMilestones.attempt),
          asc(investigationMilestones.seq),
        );
      return rows.map((row) =>
        InvestigationMilestoneSchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
        }),
      );
    },
    async acquire(id, token, now, leaseMs) {
      if (
        !Number.isFinite(now.getTime()) ||
        !Number.isFinite(leaseMs) ||
        leaseMs <= 0
      )
        throw new RangeError("Invalid investigation lease");
      const [row] = await database()
        .update(investigations)
        .set({
          leaseToken: token,
          leaseExpiresAt: sql`clock_timestamp() + (${leaseMs} * interval '1 millisecond')`,
        })
        .where(
          and(
            eq(investigations.id, id),
            or(
              isNull(investigations.leaseToken),
              lte(investigations.leaseExpiresAt, sql`clock_timestamp()`),
            ),
          ),
        )
        .returning();
      return row ? asJob(row) : null;
    },
    async save(input, token, inputMilestone) {
      const job = InvestigationJobSchema.parse(input);
      const milestone: InvestigationMilestone | undefined = inputMilestone
        ? InvestigationMilestoneSchema.parse(inputMilestone)
        : undefined;
      if (
        milestone &&
        (milestone.investigationId !== job.id ||
          milestone.attempt !== job.attempt)
      )
        throw leaseLost();
      const retry =
        job.status === "queued" &&
        !milestone &&
        Object.values(job.counters).every((n) => n === 0);
      return database().transaction(async (tx) => {
        const [row] = await tx
          .update(investigations)
          .set(mutableValues(job))
          .where(
            and(
              eq(investigations.id, job.id),
              eq(investigations.leaseToken, token),
              gt(investigations.leaseExpiresAt, sql`clock_timestamp()`),
              eq(investigations.revision, job.revision),
              or(
                eq(investigations.attempt, job.attempt),
                retry
                  ? and(
                      eq(investigations.attempt, job.attempt - 1),
                      inArray(investigations.status, ["failed", "interrupted"]),
                    )
                  : undefined,
              ),
            ),
          )
          .returning();
        if (!row) throw leaseLost();
        if (milestone) {
          // Bind JSON text explicitly so a valid JSON null never becomes SQL NULL.
          await tx.insert(investigationMilestones).values({
            ...milestone,
            summary: sql`${JSON.stringify(milestone.summary)}::jsonb`,
            createdAt: new Date(milestone.createdAt),
          });
        }
        return asJob(row);
      });
    },
    async release(id, token) {
      await database()
        .update(investigations)
        .set({ leaseToken: null, leaseExpiresAt: null })
        .where(
          and(eq(investigations.id, id), eq(investigations.leaseToken, token)),
        );
    },
  };
}
