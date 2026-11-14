import { z } from "zod";

const cents = z.number().int().safe();
const count = cents.nonnegative();
export const NessieAccountSchema = z
  .object({
    id: z.string().min(1),
    nickname: z.string(),
    type: z.enum(["Checking", "Savings"]),
    balanceCents: cents,
    availableCents: cents,
  })
  .strict();
export type NessieAccount = z.infer<typeof NessieAccountSchema>;

export const NessieSnapshotSchema = z
  .object({
    accountId: z.string().min(1),
    asOf: z.iso.datetime(),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    windowDays: z.literal(30),
    inflowCents: count,
    outflowCents: count,
    netCashFlowCents: cents,
    completedTransactionCount: count,
    excludedTransfersCount: count,
    upcomingBillsCents: count,
  })
  .strict()
  .refine(
    (s) =>
      s.windowEnd === s.asOf &&
      Date.parse(s.windowEnd) - Date.parse(s.windowStart) === 30 * 86_400_000 &&
      s.netCashFlowCents === s.inflowCents - s.outflowCents,
    "Snapshot window and totals must be consistent",
  );
export type NessieSnapshot = z.infer<typeof NessieSnapshotSchema>;

export const NessieCashFlowResponseSchema = z
  .object({
    status: z.enum(["unconfigured", "empty", "ready"]),
    source: z.literal("nessie"),
    synthetic: z.literal(true),
    accounts: z.array(NessieAccountSchema),
    snapshot: NessieSnapshotSchema.nullable(),
    message: z.string(),
  })
  .strict()
  .superRefine((response, ctx) => {
    const ids = response.accounts.map((a) => a.id);
    if (
      new Set(ids).size !== ids.length ||
      (response.status === "ready"
        ? ids.length === 0
        : ids.length !== 0 || response.snapshot !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Accounts must agree with integration status",
      });
    if (response.snapshot && !ids.includes(response.snapshot.accountId))
      ctx.addIssue({
        code: "custom",
        path: ["snapshot", "accountId"],
        message: "Snapshot account must be listed",
      });
  });
export type NessieCashFlowResponse = z.infer<
  typeof NessieCashFlowResponseSchema
>;

const ContributionIntervalSchema = z
  .object({
    low: z.number().finite(),
    mean: z.number().finite(),
    high: z.number().finite(),
  })
  .strict()
  .refine((r) => r.low <= r.high, "Invalid percentile interval");
export const NessieCashProjectionSchema = z
  .object({
    cashAfterOneMonthCents: z
      .object({ low: cents, mean: cents, high: cents })
      .strict(),
    coverage: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("depleted"), months: z.literal(0) }).strict(),
      z
        .object({
          kind: z.literal("burning"),
          months: z.number().nonnegative().finite(),
        })
        .strict(),
      z.object({ kind: z.literal("no_loss"), months: z.null() }).strict(),
    ]),
  })
  .strict();
export const NessieConsultantScenarioSchema = z
  .object({
    comparisonId: z.string().min(1),
    siteId: z.string().min(1),
    modeledUpfrontBuildoutCents: count,
    monthlyContributionUsd: ContributionIntervalSchema,
    projection: NessieCashProjectionSchema,
  })
  .strict();
export type NessieConsultantScenario = z.infer<
  typeof NessieConsultantScenarioSchema
>;

/** Saved tool evidence, scoped to one investigation attempt and immutable profile. */
export const NessieConsultantResultSchema = z
  .object({
    kind: z.literal("nessie_cash_buffer"),
    source: z.literal("nessie"),
    synthetic: z.literal(true),
    investigationId: z.string().min(1),
    attempt: z.number().int().positive(),
    projectId: z.string().min(1),
    profileId: z.string().min(1),
    profileVersion: z.number().int().positive(),
    status: z.enum([
      "ready",
      "unconfigured",
      "empty",
      "provider_error",
      "account_selection_required",
      "account_not_found",
      "comparison_unavailable",
    ]),
    message: z.string().min(1),
    accounts: z.array(NessieAccountSchema),
    selectedAccount: NessieAccountSchema.nullable(),
    snapshot: NessieSnapshotSchema.nullable(),
    scenario: NessieConsultantScenarioSchema.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ids = r.accounts.map((a) => a.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate account choices" });
    if (r.status === "ready") {
      if (
        !r.selectedAccount ||
        !r.snapshot ||
        r.snapshot.accountId !== r.selectedAccount.id ||
        !r.accounts.some(
          (a) => JSON.stringify(a) === JSON.stringify(r.selectedAccount),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Ready evidence requires a listed account and its snapshot",
        });
    } else if (r.selectedAccount || r.snapshot || r.scenario)
      ctx.addIssue({
        code: "custom",
        message: "Unavailable evidence cannot contain financial guidance",
      });
    if (r.status === "account_selection_required" && r.accounts.length < 2)
      ctx.addIssue({
        code: "custom",
        message: "Account choice requires multiple accounts",
      });
  });
export type NessieConsultantResult = z.infer<
  typeof NessieConsultantResultSchema
>;
