import {
  InvestigationJobSchema,
  InvestigationMilestoneSchema,
} from "@/lib/contracts/investigations";
import {
  InvestigationJobError,
  type InvestigationJob,
  type InvestigationMilestone,
  type InvestigationRepository,
} from "./jobs";

/** Offline/test adapter with the same lease and compare-and-swap contract as Postgres. */
export function createMemoryInvestigationRepository(
  options: { now?: () => Date } = {},
): InvestigationRepository {
  const now = options.now ?? (() => new Date());
  const jobs = new Map<string, InvestigationJob>();
  const milestones = new Map<string, InvestigationMilestone>();
  const leases = new Map<string, { token: string; expiresAt: number }>();
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    async create(job) {
      if (jobs.has(job.id)) throw new Error("Investigation already exists");
      const parsed = InvestigationJobSchema.parse(job);
      jobs.set(job.id, copy(parsed));
      return copy(parsed);
    },
    async load(id) {
      return copy(jobs.get(id) ?? null);
    },
    async listMilestones(id, attempt) {
      return copy(
        [...milestones.values()]
          .filter(
            (m) =>
              m.investigationId === id &&
              (attempt === undefined || m.attempt === attempt),
          )
          .sort((a, b) => a.attempt - b.attempt || a.seq - b.seq),
      );
    },
    async acquire(id, token, _at, leaseMs) {
      const job = jobs.get(id);
      const lease = leases.get(id);
      if (!job || (lease && lease.expiresAt > now().getTime())) return null;
      leases.set(id, { token, expiresAt: now().getTime() + leaseMs });
      return copy(job);
    },
    async save(job, token, milestone) {
      const current = jobs.get(job.id);
      const lease = leases.get(job.id);
      const retry =
        current &&
        job.attempt === current.attempt + 1 &&
        (current.status === "interrupted" || current.status === "failed") &&
        job.status === "queued" &&
        Object.values(job.counters).every((count) => count === 0) &&
        !milestone;
      if (
        !current ||
        !lease ||
        lease.token !== token ||
        lease.expiresAt <= now().getTime() ||
        current.revision !== job.revision ||
        (job.attempt !== current.attempt && !retry)
      )
        throw new InvestigationJobError(
          "lease_lost",
          "Investigation ownership changed",
        );
      const parsed = InvestigationJobSchema.parse({
        ...job,
        revision: job.revision + 1,
      });
      let key: string | undefined;
      if (milestone) {
        InvestigationMilestoneSchema.parse(milestone);
        key = `${milestone.investigationId}:${milestone.attempt}:${milestone.seq}`;
        if (
          milestone.investigationId !== job.id ||
          milestone.attempt !== job.attempt ||
          milestones.has(key)
        )
          throw new InvestigationJobError(
            "lease_lost",
            "Investigation checkpoint conflict",
          );
      }
      jobs.set(job.id, copy(parsed));
      if (key && milestone) milestones.set(key, copy(milestone));
      return copy(parsed);
    },
    async release(id, token) {
      if (leases.get(id)?.token === token) leases.delete(id);
    },
  };
}
