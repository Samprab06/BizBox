import { z } from "zod";
import { LocationPlanSchema, OriginSchema } from ".";
import { DemandSourceSchema, SiteTweaksSchema } from "./evaluation";

const id = z.string().min(1).max(300);
export const PlanReferenceSchema = z.union([
  z.object({ comparisonId: id, metric: id }).strict(),
  z.object({ runId: id, metric: id }).strict(),
  z.object({ evidenceId: id, metric: id }).strict(),
]);
export type PlanReference = z.infer<typeof PlanReferenceSchema>;
export const PlanFactSchema = z
  .object({
    reference: PlanReferenceSchema,
    range: z
      .object({ low: z.number().finite(), high: z.number().finite() })
      .refine((v) => v.low <= v.high),
    unit: z.string().min(1),
    origins: z.array(OriginSchema).min(1),
    evidenceIds: z.array(id),
    kind: z.enum(["scenario_interval", "input", "tested_interval"]),
  })
  .strict();
export type PlanFact = z.infer<typeof PlanFactSchema>;

// A closed vocabulary prevents both digit and spelled-out model-written numbers,
// fabricated claims and prompt-injected narrative. Values are resolved separately.
export const NarrativeClaimSchema = z
  .object({
    statement: z.enum([
      "Compare the scenario ranges before committing.",
      "Validate the cited assumption on site.",
      "Review the tested sensitivity before signing.",
    ]),
    references: z.array(PlanReferenceSchema).min(1).max(8),
  })
  .strict();
export const PlanNarrativeSchema = z
  .object({ claims: z.array(NarrativeClaimSchema).min(1).max(12) })
  .strict();
export type PlanNarrative = z.infer<typeof PlanNarrativeSchema>;

export const GroundedLocationPlanSchema = z
  .object({
    plan: LocationPlanSchema,
    status: z.enum([
      "recommended",
      "tie",
      "no_site_meets_budget",
      "budget_unknown",
    ]),
    runnerUpSiteId: id.nullable(),
    tiedSiteIds: z.array(id),
    why: z.array(
      z.object({
        siteId: id,
        explanation: z.string(),
        facts: z.array(PlanFactSchema),
      }),
    ),
    leaseTargets: z.array(PlanFactSchema),
    staffingAndStations: z.array(PlanFactSchema),
    buildoutBudget: z.array(PlanFactSchema),
    firstNinetyDays: z.array(
      z.object({
        check: z.string(),
        references: z.array(PlanReferenceSchema).min(1),
      }),
    ),
    assumptions: z.array(
      z.object({
        path: z.string(),
        reference: PlanReferenceSchema,
        origin: OriginSchema,
        fact: PlanFactSchema.nullable(),
        qualitativeValue: z.union([z.string(), z.boolean()]).nullable(),
        sensitivity: z.object({
          status: z.enum(["tested", "not_tested"]),
          conclusion: z.string(),
          references: z.array(PlanReferenceSchema),
        }),
      }),
    ),
    sensitivity: z.array(
      z.object({
        assumption: z.string(),
        conclusion: z.string(),
        topChanges: z.boolean(),
        testedRange: PlanFactSchema,
        flipBracket: PlanFactSchema.nullable(),
      }),
    ),
    findings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        siteId: z.string().optional(),
        reference: PlanReferenceSchema,
      }),
    ),
    demand: z.object({
      requested: z.enum(["huff", "jev"]),
      actual: z.enum(["huff", "jev"]),
      fallbackReason: z.string().nullable(),
      huffAgreement: z.enum([
        "agreed",
        "disagreed",
        "not_independent",
        "not_tested",
      ]),
      reference: PlanReferenceSchema,
    }),
    facts: z.array(PlanFactSchema),
    narrative: PlanNarrativeSchema.nullable(),
  })
  .strict();
export type GroundedLocationPlan = z.infer<typeof GroundedLocationPlanSchema>;

/** A modeled range (mean with a low-high interval across seeds). */
const SummaryRangeSchema = z
  .object({
    mean: z.number().finite(),
    low: z.number().finite(),
    high: z.number().finite(),
  })
  .strict()
  .refine((v) => v.low <= v.high, "low must not exceed high");

/**
 * Scene 1: what the "Final plan" step shows once the founder and the consultant finalize.
 * Built on the client from the stored comparison (+ its /plan) and the `finalize_plan`
 * action, then kept in the project's flow store. Ranges are modeled, not measured traffic.
 */
export const FinalPlanSummarySchema = z
  .object({
    projectId: id,
    comparisonId: id,
    chosenSiteId: id,
    chosenAddress: z.string().min(1).max(300),
    rationale: z.string().min(1).max(2000),
    finalizedAt: z.string().datetime(),
    demandSource: DemandSourceSchema,
    metrics: z
      .object({
        monthlyServedCustomers: SummaryRangeSchema,
        monthlyContributionUsd: SummaryRangeSchema,
        weekdayMeanWaitMin: SummaryRangeSchema.optional(),
      })
      .strict(),
    /** Per-site changes that were applied in the finalized comparison. */
    tweaks: SiteTweaksSchema.optional(),
    runnerUp: z
      .object({
        siteId: id,
        address: z.string().min(1).max(300),
        monthlyContributionUsd: SummaryRangeSchema,
      })
      .strict()
      .nullable(),
    risks: z.array(z.string().min(1).max(500)).max(8),
    nextSteps: z.array(z.string().min(1).max(500)).min(1).max(8),
  })
  .strict();
export type FinalPlanSummary = z.infer<typeof FinalPlanSummarySchema>;
