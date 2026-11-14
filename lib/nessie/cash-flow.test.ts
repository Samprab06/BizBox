import { describe, expect, it } from "vitest";
import {
  createNessieSnapshot,
  type NessieTransaction,
  type NessieBill,
} from "./cash-flow";
const asOf = new Date("2026-11-14T17:00:00Z");
const tx = (patch: Partial<NessieTransaction> = {}): NessieTransaction => ({
  id: "tx_1",
  kind: "purchase",
  status: "completed",
  medium: "balance",
  amount_cents: 100,
  payer_id: "acct_a",
  created_at: "2026-11-10T10:00:00Z",
  ...patch,
});
const bill = (patch: Partial<NessieBill> = {}): NessieBill => ({
  id: "bill_1",
  account_id: "acct_a",
  status: "pending",
  upcoming_payment_date: "2026-11-20",
  payment_amount: 19.99,
  ...patch,
});
const snapshot = (
  transactions: NessieTransaction[],
  bills: NessieBill[] = [],
) => createNessieSnapshot({ accountId: "acct_a", transactions, bills, asOf });
describe("Nessie cash movements", () => {
  it("attributes deposits to payee and ordinary charges/credits to payer", () => {
    const s = snapshot([
      tx({
        id: "deposit",
        kind: "deposit",
        payer_id: undefined,
        payee_id: "acct_a",
        amount_cents: 10000,
      }),
      tx({ id: "refund", kind: "refund", amount_cents: 200 }),
      tx({ id: "interest", kind: "interest_credit", amount_cents: 50 }),
      tx({ id: "charge" }),
      tx({ id: "chargeback", kind: "chargeback", amount_cents: 300 }),
      tx({
        id: "other-deposit",
        kind: "deposit",
        payer_id: "acct_a",
        payee_id: "acct_b",
        amount_cents: 99999,
      }),
      tx({ id: "other-purchase", payer_id: "acct_b" }),
    ]);
    expect(s).toMatchObject({
      inflowCents: 10250,
      outflowCents: 400,
      netCashFlowCents: 9850,
      completedTransactionCount: 5,
    });
  });
  it("excludes transfers, rewards, and transactions that never posted", () => {
    const s = snapshot([
      tx({ id: "out", kind: "transfer", payee_id: "acct_b" }),
      tx({
        id: "in",
        kind: "transfer",
        payer_id: "acct_b",
        payee_id: "acct_a",
      }),
      tx({
        id: "unrelated",
        kind: "transfer",
        payer_id: "acct_b",
        payee_id: "acct_c",
      }),
      tx({ id: "rewards", medium: "rewards" }),
      ...(["pending", "declined", "cancelled"] as const).map((status) =>
        tx({ id: status, status }),
      ),
    ]);
    expect(s).toMatchObject({
      inflowCents: 0,
      outflowCents: 0,
      completedTransactionCount: 0,
      excludedTransfersCount: 2,
    });
  });
  it("uses an inclusive exact 30-day UTC interval and excludes the future", () => {
    const s = snapshot([
      tx({ id: "start", created_at: "2026-10-15T17:00:00Z" }),
      tx({ id: "before", created_at: "2026-10-15T16:59:59Z" }),
      tx({ id: "end", created_at: asOf.toISOString() }),
      tx({ id: "future", created_at: "2026-11-14T17:00:01Z" }),
    ]);
    expect(s).toMatchObject({
      outflowCents: 200,
      windowStart: "2026-10-15T17:00:00.000Z",
      windowEnd: asOf.toISOString(),
      windowDays: 30,
    });
  });
  it("sums only this account's upcoming unpaid bills, including today date-only", () => {
    const s = snapshot(
      [],
      [
        bill(),
        bill({
          id: "today",
          upcoming_payment_date: "2026-11-14",
          payment_amount: 0.29,
        }),
        bill({ id: "recurring", status: "recurring", payment_amount: 10 }),
        bill({ id: "overdue", upcoming_payment_date: "2026-11-13" }),
        bill({ id: "future", upcoming_payment_date: "2026-12-15" }),
        bill({ id: "other", account_id: "acct_b" }),
        bill({ id: "cancelled", status: "cancelled" }),
        bill({ id: "completed", status: "completed" }),
        bill({ id: "invalid", upcoming_payment_date: "not a date" }),
      ],
    );
    expect(s.upcomingBillsCents).toBe(3028);
  });
  it("does not double count repeated ids and rejects conflicting copies", () => {
    expect(snapshot([tx(), tx()]).outflowCents).toBe(100);
    expect(() => snapshot([tx(), tx({ amount_cents: 200 })])).toThrow();
    expect(snapshot([], [bill(), bill()]).upcomingBillsCents).toBe(1999);
  });
  it("rejects unsafe cents, aggregate overflow, invalid clocks and fractional bill cents", () => {
    expect(() =>
      snapshot([tx({ amount_cents: Number.MAX_SAFE_INTEGER + 1 })]),
    ).toThrow();
    expect(() =>
      snapshot([
        tx({ amount_cents: Number.MAX_SAFE_INTEGER }),
        tx({ id: "second" }),
      ]),
    ).toThrow();
    expect(() => snapshot([], [bill({ payment_amount: 1.001 })])).toThrow();
    expect(() =>
      createNessieSnapshot({
        accountId: "acct_a",
        transactions: [],
        bills: [],
        asOf: new Date("invalid"),
      }),
    ).toThrow();
  });
});
