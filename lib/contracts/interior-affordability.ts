import { z } from "zod";
import {
  NessieCashProjectionSchema,
  NessieConsultantResultSchema,
} from "./nessie";
import {
  SpatialDraftSchema,
  SpatialPoliciesSchema,
  SpatialPolicyReceiptSchema,
} from "./spatial";
const id = z.string().trim().min(1).max(200);
const cents = z.number().int().safe();
const range = z
  .object({
    mean: z.number().finite(),
    low: z.number().finite(),
    high: z.number().finite(),
  })
  .strict();
const estimate = z
  .object({
    mean: z.number().finite(),
    p5: z.number().finite(),
    p95: z.number().finite(),
  })
  .strict();
export const InteriorAffordabilityRequestSchema = z
  .object({
    comparisonId: id,
    siteId: id,
    baseline: SpatialDraftSchema,
    draft: SpatialDraftSchema,
    ranRevision: z.number().int().nonnegative(),
    reviewedRevision: z.number().int().nonnegative(),
    policies: SpatialPoliciesSchema.optional(),
    policyReceipt: SpatialPolicyReceiptSchema.optional(),
    accountId: id.optional(),
  })
  .strict()
  .refine(
    (input) => Boolean(input.policies) === Boolean(input.policyReceipt),
    "Jev policies require a matching signed receipt",
  );
export type InteriorAffordabilityRequest = z.infer<
  typeof InteriorAffordabilityRequestSchema
>;
export const InteriorAffordabilityAssessmentSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: id,
    comparisonId: id,
    siteId: id,
    draftId: id,
    revision: z.number().int().nonnegative(),
    baselineRevision: z.number().int().nonnegative(),
    assessedAt: z.iso.datetime(),
    source: z.literal("nessie"),
    synthetic: z.literal(true),
    status: NessieConsultantResultSchema.shape.status,
    nessie: NessieConsultantResultSchema,
    knownUpfrontBuildoutCents: cents.nonnegative(),
    missingCosts: z.array(z.string().min(1)).max(20),
    completeAffordability: z.literal(false),
    projectionBasis: z.literal("stored-exterior-operating-only"),
    operatingImpact: z
      .object({
        period: z.literal("modeled-operating-day"),
        dailyContributionDeltaUsd: estimate,
        baselineDailyContributionUsd: estimate,
        proposalDailyContributionUsd: estimate,
        appliedToMonthlyProjection: z.literal(false),
        behaviorSource: z.enum(["jev", "assumed", "mixed"]),
      })
      .strict(),
    proposalProjection: z
      .object({
        basis: z.literal("reviewed-interior-weekdays-only"),
        weekdayDaysPerMonth: z.number().int().nonnegative(),
        monthlyOperatingContributionUsd: range,
        projection: NessieCashProjectionSchema,
      })
      .strict()
      .nullable(),
    limitations: z.array(z.string().min(1)).max(30),
  })
  .strict()
  .refine(
    (value) =>
      value.status === value.nessie.status &&
      value.projectId === value.nessie.projectId &&
      (value.status === "ready" || value.proposalProjection === null) &&
      (!value.nessie.scenario ||
        (value.nessie.scenario.comparisonId === value.comparisonId &&
          value.nessie.scenario.siteId === value.siteId &&
          value.nessie.scenario.modeledUpfrontBuildoutCents ===
            value.knownUpfrontBuildoutCents)),
    "Affordability evidence must preserve source status, identity and costs",
  );
export type InteriorAffordabilityAssessment = z.infer<
  typeof InteriorAffordabilityAssessmentSchema
>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Version key only: no balance or model-authored financial outcome is accepted as input. */
export async function interiorAffordabilityFingerprint(
  projectId: string,
  raw: InteriorAffordabilityRequest,
): Promise<string> {
  const input = InteriorAffordabilityRequestSchema.parse(raw);
  const bytes = new TextEncoder().encode(
    canonical({ version: 1, projectId, input }),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
