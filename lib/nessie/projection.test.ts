import { describe, expect, test } from "vitest";
import { projectCashBuffer, upfrontCostCents } from "./projection";

describe("projectCashBuffer", () => {
  test("subtracts upfront cost once and adds the modeled monthly contribution range", () => {
    expect(
      projectCashBuffer(100_000, 20_000, { low: -300, mean: -200, high: 100 }),
    ).toEqual({
      cashAfterOneMonthCents: { low: 50_000, mean: 60_000, high: 90_000 },
      coverage: { kind: "burning", months: 4 },
    });
  });

  test("preserves negative projected cash and reports a depleted starting buffer", () => {
    expect(
      projectCashBuffer(1_000, 2_000, { low: -20, mean: -10, high: 0 }),
    ).toEqual({
      cashAfterOneMonthCents: { low: -3_000, mean: -2_000, high: -1_000 },
      coverage: { kind: "depleted", months: 0 },
    });
  });

  test.each([0, 20])(
    "does not invent a finite runway for nonnegative contribution %s",
    (mean) => {
      expect(
        projectCashBuffer(10_000, 0, { low: -1, mean, high: 25 }).coverage,
      ).toEqual({
        kind: "no_loss",
        months: null,
      });
    },
  );

  test("rounds model dollars to integer cents", () => {
    expect(
      projectCashBuffer(100, 0, { low: 0.004, mean: 0.005, high: 0.006 })
        .cashAfterOneMonthCents,
    ).toEqual({
      low: 100,
      mean: 101,
      high: 101,
    });
  });

  test("allows an arithmetic mean outside a skewed percentile interval", () => {
    expect(
      projectCashBuffer(10_000, 0, { low: -10, mean: 30, high: 20 })
        .cashAfterOneMonthCents,
    ).toEqual({ low: 9000, mean: 13_000, high: 12_000 });
  });

  test("does not relabel a sub-cent modeled monthly loss as no loss", () => {
    expect(
      projectCashBuffer(1, 0, { low: -0.004, mean: -0.0025, high: 0 }).coverage,
    ).toEqual({ kind: "burning", months: 4 });
  });

  test.each([
    [NaN, 0, { low: 0, mean: 0, high: 0 }],
    [1.5, 0, { low: 0, mean: 0, high: 0 }],
    [100, -1, { low: 0, mean: 0, high: 0 }],
    [100, 0, { low: 3, mean: 1, high: 2 }],
    [100, 0, { low: 0, mean: Infinity, high: Infinity }],
    [Number.MAX_SAFE_INTEGER, 0, { low: 0, mean: 1, high: 2 }],
  ] as const)(
    "rejects invalid or unsafe arithmetic %#",
    (available, upfront, contribution) => {
      expect(() =>
        projectCashBuffer(available, upfront, contribution),
      ).toThrow();
    },
  );
});

describe("upfrontCostCents", () => {
  test.each([
    ["0", 0],
    ["12.34", 1234],
    ["0.29", 29],
    ["12.3", 1230],
  ])("parses %s without floating-point cents", (value, expected) => {
    expect(upfrontCostCents(value)).toBe(expected);
  });
  test.each([
    "",
    "-1",
    "1.001",
    "Infinity",
    "1e3",
    "9007199254740992",
    "12abc",
  ])("rejects %s", (value) => {
    expect(() => upfrontCostCents(value)).toThrow();
  });
});
