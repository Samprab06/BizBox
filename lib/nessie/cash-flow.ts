import { z } from "zod";
import {
  NessieSnapshotSchema,
  type NessieSnapshot,
} from "@/lib/contracts/nessie";

const safeCents = z.number().int().safe();
export const NessieTransactionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "deposit",
      "withdrawal",
      "transfer",
      "purchase",
      "bill_payment",
      "fee",
      "interest_credit",
      "refund",
      "chargeback",
    ]),
    status: z.enum(["pending", "completed", "declined", "cancelled"]),
    medium: z.enum(["balance", "rewards"]),
    amount_cents: safeCents.positive(),
    payer_id: z.string().optional(),
    payee_id: z.string().optional(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .refine(
    (t) =>
      t.kind === "deposit"
        ? Boolean(t.payee_id)
        : Boolean(t.payer_id) && (t.kind !== "transfer" || Boolean(t.payee_id)),
    "Transaction direction is missing",
  );
export type NessieTransaction = z.infer<typeof NessieTransactionSchema>;

export const NessieBillSchema = z.object({
  id: z.string().min(1),
  account_id: z.string().min(1),
  status: z.enum(["pending", "cancelled", "completed", "recurring"]),
  upcoming_payment_date: z.string(),
  payment_amount: z.number().nonnegative().finite(),
});
export type NessieBill = z.infer<typeof NessieBillSchema>;

/** Reject conflicting duplicates instead of silently counting inconsistent pages. */
export function uniqueNessieRecords<T extends { id: string }>(
  rows: readonly T[],
): T[] {
  const records = new Map<string, T>();
  for (const row of rows) {
    const previous = records.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row))
      throw new RangeError("Conflicting Nessie records");
    records.set(row.id, row);
  }
  return [...records.values()];
}

function safeInteger(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new RangeError("Cash amount exceeds supported range");
  return n;
}

function billCents(dollars: number): bigint {
  const raw = dollars * 100;
  const rounded = Math.round(raw);
  if (!Number.isSafeInteger(rounded) || Math.abs(raw - rounded) > 1e-7)
    throw new RangeError("Bill amount is not safe cents");
  return BigInt(rounded);
}

/** Date-only bills are due on that UTC calendar day, including today's day. */
function billDueInWindow(value: string, now: number, end: number): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== value
    )
      return false;
    const startDay = Math.floor(now / 86_400_000) * 86_400_000;
    const endDay = Math.floor(end / 86_400_000) * 86_400_000;
    return parsed >= startDay && parsed <= endDay;
  }
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success) return false;
  const due = Date.parse(parsed.data);
  return due >= now && due <= end;
}

export function createNessieSnapshot({
  accountId,
  transactions,
  bills,
  asOf,
}: {
  accountId: string;
  transactions: readonly NessieTransaction[];
  bills: readonly NessieBill[];
  asOf: Date;
}): NessieSnapshot {
  const end = asOf.getTime();
  if (!Number.isFinite(end) || !accountId)
    throw new RangeError("Invalid snapshot inputs");
  const start = end - 30 * 86_400_000;
  let inflow = 0n,
    outflow = 0n,
    upcoming = 0n;
  let completedTransactionCount = 0,
    excludedTransfersCount = 0;
  const rows = uniqueNessieRecords(
    z.array(NessieTransactionSchema).parse(transactions),
  );
  for (const t of rows) {
    const when = Date.parse(t.created_at);
    if (
      t.status !== "completed" ||
      t.medium !== "balance" ||
      when < start ||
      when > end
    )
      continue;
    if (t.kind === "transfer") {
      if (t.payer_id === accountId || t.payee_id === accountId)
        excludedTransfersCount++;
      continue;
    }
    // Nessie v2 assigns deposits to payee; all other path-account postings to payer.
    if ((t.kind === "deposit" ? t.payee_id : t.payer_id) !== accountId)
      continue;
    if (["deposit", "interest_credit", "refund"].includes(t.kind))
      inflow += BigInt(t.amount_cents);
    else outflow += BigInt(t.amount_cents);
    completedTransactionCount++;
  }
  for (const b of uniqueNessieRecords(z.array(NessieBillSchema).parse(bills))) {
    if (
      b.account_id === accountId &&
      (b.status === "pending" || b.status === "recurring") &&
      billDueInWindow(b.upcoming_payment_date, end, end + 30 * 86_400_000)
    )
      upcoming += billCents(b.payment_amount);
  }
  return NessieSnapshotSchema.parse({
    accountId,
    asOf: asOf.toISOString(),
    windowStart: new Date(start).toISOString(),
    windowEnd: asOf.toISOString(),
    windowDays: 30,
    inflowCents: safeInteger(inflow),
    outflowCents: safeInteger(outflow),
    netCashFlowCents: safeInteger(inflow - outflow),
    completedTransactionCount,
    excludedTransfersCount,
    upcomingBillsCents: safeInteger(upcoming),
  });
}
