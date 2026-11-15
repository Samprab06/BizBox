import { randomUUID } from "node:crypto";
import { withoutNessieFindings } from "@/lib/nessie/findings";
import {
  CreateInvestigationSchema,
  INVESTIGATION_LIMITS,
  InvestigationJobSchema,
  InvestigationMilestoneSchema,
  type CreateInvestigationInput,
  type InvestigationJob,
  type InvestigationMilestone,
} from "@/lib/contracts/investigations";
export type {
  InvestigationJob,
  InvestigationMilestone,
  CreateInvestigationInput,
} from "@/lib/contracts/investigations";

/** All writes are short atomic commits; never hold a transaction during tool work.
 * save must fence owner token, live lease, revision, and attempt, increment revision,
 * and atomically insert an optional milestone (unique investigation/attempt/seq).
 * Attempt may advance by exactly one only for retry: queued, zero counters, no milestone.
 */
export interface InvestigationRepository {
  create(job: InvestigationJob): Promise<InvestigationJob>;
  load(id: string): Promise<InvestigationJob | null>;
  listMilestones(
    id: string,
    attempt?: number,
  ): Promise<InvestigationMilestone[]>;
  acquire(
    id: string,
    token: string,
    now: Date,
    leaseMs: number,
  ): Promise<InvestigationJob | null>;
  save(
    job: InvestigationJob,
    token: string,
    milestone?: InvestigationMilestone,
  ): Promise<InvestigationJob>;
  release(id: string, token: string): Promise<void>;
}
export class InvestigationJobError extends Error {
  constructor(
    public readonly code: "not_found" | "busy" | "invalid_state" | "lease_lost",
    message: string,
  ) {
    super(message);
    this.name = "InvestigationJobError";
  }
}
export type InvestigationStepPlanner = (input: {
  job: InvestigationJob;
  milestones: InvestigationMilestone[];
  nextSeq: number;
  signal: AbortSignal;
}) => Promise<{
  tool: string;
  inputHash: string;
  execute(input: {
    signal: AbortSignal;
    idempotencyKey: string;
    /** Epoch ms (Date.now clock) a step should finish by, ahead of the hard abort (HAC-155). */
    deadlineAt?: number;
  }): Promise<{
    summary: InvestigationMilestone["summary"];
    findings?: string[];
    done?: boolean;
  }>;
} | null>;

export const INVESTIGATION_STALE_MS = 5 * 60_000;
const zeroCounters = () => ({
  toolCalls: 0,
  pollCustomers: 0,
  evaluateSites: 0,
});
const active = (job: InvestigationJob) =>
  job.status === "queued" || job.status === "running";
class DeadlineReached extends Error {}
/**
 * A tool that ran out of time but kept its progress (e.g. a deadline-limited Jev panel, HAC-155)
 * throws an error with `resumable: true`. The step is not a failure: no milestone is written,
 * its counter reservation is returned, and the job stays active so the next advance repeats it.
 */
const resumableStep = (error: unknown): error is Error =>
  error instanceof Error &&
  (error as Error & { resumable?: unknown }).resumable === true;

export function createInvestigationService(
  repository: InvestigationRepository,
  options: {
    now?: () => Date;
    id?: () => string;
    token?: () => string;
    resumeToolTimeouts?: boolean;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const token = options.token ?? randomUUID;
  const stale = (job: InvestigationJob) =>
    active(job) &&
    job.lastAdvanceAt !== null &&
    now().getTime() - Date.parse(job.lastAdvanceAt) >= INVESTIGATION_STALE_MS;
  async function leased<T>(
    jobId: string,
    leaseMs: number,
    run: (job: InvestigationJob, owner: string) => Promise<T>,
  ): Promise<T> {
    const owner = token();
    const job = await repository.acquire(jobId, owner, now(), leaseMs);
    if (!job) {
      if (!(await repository.load(jobId)))
        throw new InvestigationJobError("not_found", "Investigation not found");
      throw new InvestigationJobError(
        "busy",
        "Investigation is already being advanced",
      );
    }
    try {
      return await run(job, owner);
    } finally {
      await repository.release(jobId, owner);
    }
  }
  const save = (
    job: InvestigationJob,
    owner: string,
    milestone?: InvestigationMilestone,
  ) =>
    repository.save(
      InvestigationJobSchema.parse({ ...job, updatedAt: now().toISOString() }),
      owner,
      milestone,
    );
  const interrupted = (job: InvestigationJob, owner: string) =>
    save(
      {
        ...job,
        status: "interrupted",
        reason: "No advancement for five minutes",
      },
      owner,
    );

  return {
    async create(input: CreateInvestigationInput): Promise<InvestigationJob> {
      const parsed = CreateInvestigationSchema.parse(input);
      const at = now().toISOString();
      return repository.create(
        InvestigationJobSchema.parse({
          ...parsed,
          id: id(),
          status: "queued",
          attempt: 1,
          limits: { ...INVESTIGATION_LIMITS, ...parsed.limits },
          counters: zeroCounters(),
          findings: [],
          lastAdvanceAt: null,
          createdAt: at,
          updatedAt: at,
          reason: null,
          revision: 0,
        }),
      );
    },
    async load(jobId: string): Promise<InvestigationJob> {
      const job = await repository.load(jobId);
      if (!job)
        throw new InvestigationJobError("not_found", "Investigation not found");
      if (!stale(job)) return job;
      return leased(jobId, 5000, async (current, owner) =>
        stale(current) ? interrupted(current, owner) : current,
      );
    },
    async markInterrupted(jobId: string): Promise<InvestigationJob> {
      return leased(jobId, 5000, async (job, owner) =>
        active(job)
          ? save(
              {
                ...job,
                status: "interrupted",
                reason: "Investigation explicitly interrupted",
              },
              owner,
            )
          : job,
      );
    },
    async retry(jobId: string): Promise<InvestigationJob> {
      return leased(jobId, 5000, async (job, owner) => {
        if (stale(job)) job = await interrupted(job, owner);
        if (job.status !== "interrupted" && job.status !== "failed")
          throw new InvestigationJobError(
            "invalid_state",
            "Only failed or interrupted investigations can be retried",
          );
        // Findings otherwise survive retry. Optional banking evidence belongs to
        // its old snapshot/attempt, including model prose derived from it.
        const history = await repository.listMilestones(job.id);
        const findings = withoutNessieFindings(job.findings, history);
        return save(
          {
            ...job,
            status: "queued",
            attempt: job.attempt + 1,
            findings,
            counters: zeroCounters(),
            lastAdvanceAt: null,
            reason: null,
          },
          owner,
        );
      });
    },
    async advance(
      jobId: string,
      planner: InvestigationStepPlanner,
      advanceOptions: { maxDurationMs?: number } = {},
    ): Promise<InvestigationJob> {
      const maxDuration = advanceOptions.maxDurationMs ?? 30_000;
      if (
        !Number.isFinite(maxDuration) ||
        maxDuration <= 0 ||
        maxDuration > 30_000
      )
        throw new RangeError("maxDurationMs must be in (0, 30000]");
      const budget = Math.floor(maxDuration * 0.8);
      const startedAt = now().getTime();
      const realStartedAt = performance.now();
      const remaining = () =>
        Math.max(
          0,
          budget -
            Math.max(
              now().getTime() - startedAt,
              performance.now() - realStartedAt,
            ),
        );
      return leased(jobId, budget + 5000, async (job, owner) => {
        if (stale(job)) return interrupted(job, owner);
        if (job.status === "succeeded") return job;
        if (!active(job))
          throw new InvestigationJobError(
            "invalid_state",
            "Retry the investigation before advancing it",
          );
        job = await save(
          {
            ...job,
            status: "running",
            lastAdvanceAt: now().toISOString(),
            reason: null,
          },
          owner,
        );
        const milestones = await repository.listMilestones(job.id, job.attempt);
        const controller = new AbortController();
        async function bounded<T>(run: () => Promise<T>): Promise<T> {
          const ms = remaining();
          if (ms <= 0) throw new DeadlineReached();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new DeadlineReached());
            }, ms);
          });
          try {
            return await Promise.race([Promise.resolve().then(run), deadline]);
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
        let executing = false;
        let reservedFrom: InvestigationJob["counters"] | null = null;
        try {
          while (remaining() > 0) {
            const nextSeq = milestones.length;
            const plan = await bounded(() =>
              planner({
                job: structuredClone(job),
                milestones: structuredClone(milestones),
                nextSeq,
                signal: controller.signal,
              }),
            );
            if (plan === null)
              return await save(
                {
                  ...job,
                  status: "succeeded",
                  reason: "Investigation completed",
                  lastAdvanceAt: now().toISOString(),
                },
                owner,
              );
            const tool = InvestigationMilestoneSchema.shape.tool.parse(
              plan.tool,
            );
            const inputHash =
              InvestigationMilestoneSchema.shape.inputHash.parse(
                plan.inputHash,
              );
            if (remaining() <= 0) break;
            const counters = {
              ...job.counters,
              toolCalls: job.counters.toolCalls + 1,
            };
            if (tool === "poll_customers") counters.pollCustomers++;
            if (tool === "evaluate_sites") counters.evaluateSites++;
            const exceeded = (
              Object.keys(counters) as (keyof typeof counters)[]
            ).find((key) => counters[key] > job.limits[key]);
            if (exceeded)
              return await save(
                {
                  ...job,
                  status: job.findings.length ? "succeeded" : "failed",
                  reason: `Investigation limit reached: ${exceeded}`,
                  lastAdvanceAt: now().toISOString(),
                },
                owner,
              );
            // Reserve paid/tool capacity durably before any tool side effect.
            reservedFrom = job.counters;
            job = await save(
              { ...job, counters, lastAdvanceAt: now().toISOString() },
              owner,
            );
            executing = true;
            // HAC-23 tools MUST implement idempotency for crash-after-side-effect /
            // before-checkpoint recovery. Finished milestones are never replayed.
            const result = await bounded(() =>
              plan.execute({
                signal: controller.signal,
                idempotencyKey: `${job.id}:${job.attempt}:${nextSeq}:${inputHash}`,
                deadlineAt: Date.now() + remaining(),
              }),
            );
            const milestone = InvestigationMilestoneSchema.parse({
              investigationId: job.id,
              attempt: job.attempt,
              seq: nextSeq,
              tool,
              inputHash,
              summary: result.summary,
              createdAt: now().toISOString(),
            });
            const findings = InvestigationJobSchema.shape.findings.parse(
              result.findings ?? [],
            );
            if (result.done !== undefined && typeof result.done !== "boolean")
              throw new Error("Invalid completion flag");
            job = await save(
              {
                ...job,
                findings: [...new Set([...job.findings, ...findings])],
                status: result.done ? "succeeded" : "running",
                reason: result.done ? "Investigation completed" : null,
                lastAdvanceAt: now().toISOString(),
              },
              owner,
              milestone,
            );
            executing = false;
            reservedFrom = null;
            milestones.push(milestone);
            if (result.done) return job;
          }
          return await save(
            {
              ...job,
              status: options.resumeToolTimeouts ? "running" : "queued",
              reason: "Advancement time budget reached",
              lastAdvanceAt: now().toISOString(),
            },
            owner,
          );
        } catch (error) {
          controller.abort();
          if (
            error instanceof InvestigationJobError &&
            error.code === "lease_lost"
          )
            throw error;
          if (executing && resumableStep(error))
            return await save(
              {
                ...job,
                counters: reservedFrom ?? job.counters,
                status: options.resumeToolTimeouts ? "running" : "queued",
                reason: error.message,
                lastAdvanceAt: now().toISOString(),
              },
              owner,
            );
          return await save(
            {
              ...job,
              status:
                error instanceof DeadlineReached
                  ? options.resumeToolTimeouts
                    ? "running"
                    : executing
                      ? "interrupted"
                      : "queued"
                  : "failed",
              reason:
                error instanceof DeadlineReached
                  ? options.resumeToolTimeouts
                    ? "Advancement time budget reached; resume from saved milestones"
                    : executing
                      ? "Tool deadline reached; retry required"
                      : "Advancement time budget reached"
                  : "Investigation step failed",
              lastAdvanceAt: now().toISOString(),
            },
            owner,
          );
        } finally {
          controller.abort();
        }
      });
    },
  };
}
