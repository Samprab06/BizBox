import { z } from "zod";

export const INVESTIGATION_LIMITS = {
  toolCalls: 25,
  pollCustomers: 3,
  evaluateSites: 3,
} as const;
/** Overall investigation wall time, including retries; rehearsal can tune this. */
export const INVESTIGATION_WALL_TIME_MS = 15 * 60_000;
export const InvestigationLimitsSchema = z
  .object({
    toolCalls: z.number().int().min(0).max(INVESTIGATION_LIMITS.toolCalls),
    pollCustomers: z
      .number()
      .int()
      .min(0)
      .max(INVESTIGATION_LIMITS.pollCustomers),
    evaluateSites: z
      .number()
      .int()
      .min(0)
      .max(INVESTIGATION_LIMITS.evaluateSites),
  })
  .strict();
export const InvestigationCountersSchema = z
  .object({
    toolCalls: z.number().int().nonnegative(),
    pollCustomers: z.number().int().nonnegative(),
    evaluateSites: z.number().int().nonnegative(),
  })
  .strict();
export const CreateInvestigationSchema = z
  .object({
    projectId: z.string().trim().min(1),
    profileId: z.string().trim().min(1),
    question: z.string().trim().min(1).max(8000),
    limits: InvestigationLimitsSchema.partial().optional(),
  })
  .strict();
export const InvestigationJobSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    profileId: z.string().min(1),
    question: z.string().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed", "interrupted"]),
    attempt: z.number().int().positive(),
    limits: InvestigationLimitsSchema,
    counters: InvestigationCountersSchema,
    findings: z.array(z.string().trim().min(1)),
    lastAdvanceAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    reason: z.string().min(1).nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (job) =>
      Object.keys(INVESTIGATION_LIMITS).every(
        (key) =>
          job.counters[key as keyof typeof INVESTIGATION_LIMITS] <=
          job.limits[key as keyof typeof INVESTIGATION_LIMITS],
      ),
    "Counters must not exceed job limits",
  );
export const InvestigationMilestoneSchema = z
  .object({
    investigationId: z.string().min(1),
    attempt: z.number().int().positive(),
    seq: z.number().int().nonnegative(),
    tool: z.string().trim().min(1),
    inputHash: z.string().trim().min(1),
    summary: z.json(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type InvestigationJob = z.infer<typeof InvestigationJobSchema>;
export type InvestigationMilestone = z.infer<
  typeof InvestigationMilestoneSchema
>;
export type CreateInvestigationInput = z.infer<
  typeof CreateInvestigationSchema
>;
