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
