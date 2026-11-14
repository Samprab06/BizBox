import { describe, expect, it } from "vitest";
import { NessieCashFlowResponseSchema } from "./nessie";

const base = {
  status: "ready",
  source: "nessie",
  synthetic: true,
  accounts: [
    {
      id: "acct_a",
      nickname: "Demo cash",
      type: "Checking",
      balanceCents: 100,
      availableCents: 50,
    },
  ],
  snapshot: null,
  message: "Choose a simulated account.",
};
describe("Nessie public response", () => {
  it("accepts a sanitized simulated cash-account response", () => {
    expect(NessieCashFlowResponseSchema.parse(base)).toEqual(base);
  });
  it("rejects debt accounts, unsafe cents, and false provenance", () => {
    for (const changed of [
      { ...base, synthetic: false },
      { ...base, accounts: [{ ...base.accounts[0], type: "Credit Card" }] },
      {
        ...base,
        accounts: [
          { ...base.accounts[0], balanceCents: Number.MAX_SAFE_INTEGER + 1 },
        ],
      },
    ])
      expect(NessieCashFlowResponseSchema.safeParse(changed).success).toBe(
        false,
      );
  });
  it("does not admit a snapshot for another account", () => {
    const at = "2026-11-14T17:00:00.000Z";
    const snapshot = {
      accountId: "acct_other",
      asOf: at,
      windowStart: "2026-10-15T17:00:00.000Z",
      windowEnd: at,
      windowDays: 30,
      inflowCents: 100,
      outflowCents: 40,
      netCashFlowCents: 60,
      completedTransactionCount: 2,
      excludedTransfersCount: 0,
      upcomingBillsCents: 20,
    };
    expect(
      NessieCashFlowResponseSchema.safeParse({ ...base, snapshot }).success,
    ).toBe(false);
    expect(
      NessieCashFlowResponseSchema.safeParse({
        ...base,
        snapshot: { ...snapshot, accountId: "acct_a" },
      }).success,
    ).toBe(true);
  });
});
