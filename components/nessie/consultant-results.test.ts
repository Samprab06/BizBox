import { describe, expect, test } from "vitest";
import { selectNessieResults } from "./consultant-results";
import type { NessieConsultantResult } from "@/lib/contracts/nessie";

const identity = {
  investigationId: "inv-current",
  projectId: "houston-coffee",
};
const account = {
  id: "acct_demo",
  nickname: "Demo checking",
  type: "Checking" as const,
  balanceCents: 100_000,
  availableCents: 80_000,
};
function result(): NessieConsultantResult {
  return {
    kind: "nessie_cash_buffer",
    source: "nessie",
    synthetic: true,
    ...identity,
    attempt: 2,
    profileId: "profile-1",
    profileVersion: 1,
    status: "ready",
    message: "One simulated account was selected.",
    accounts: [account],
    selectedAccount: account,
    snapshot: {
      accountId: account.id,
      asOf: "2026-11-14T16:00:00Z",
      windowStart: "2026-10-15T16:00:00Z",
      windowEnd: "2026-11-14T16:00:00Z",
      windowDays: 30,
      inflowCents: 1000,
      outflowCents: 2000,
      netCashFlowCents: -1000,
      completedTransactionCount: 2,
      excludedTransfersCount: 1,
      upcomingBillsCents: 3000,
    },
    scenario: null,
  };
}
function milestone(
  output: unknown = result(),
  seq = 3,
  tool = "read_nessie_cash_buffer",
  attempt = 2,
) {
  return {
    investigationId: identity.investigationId,
    attempt,
    seq,
    tool,
    summary: { output },
  };
}
function response(milestones: unknown[] = [milestone()]) {
  return {
    job: {
      id: identity.investigationId,
      projectId: identity.projectId,
      profileId: "profile-1",
      attempt: 2,
      status: "succeeded",
      findings: [],
    },
    milestones,
  };
}

describe("selectNessieResults", () => {
  test("only the newest cash step may provide guidance, including a replacement error", () => {
    const unavailable = {
      ...result(),
      status: "provider_error" as const,
      message: "Provider unavailable",
      selectedAccount: null,
      snapshot: null,
      scenario: null,
    };
    expect(
      selectNessieResults(
        response([milestone(result(), 1), milestone(unavailable, 2)]),
        identity,
      ).results,
    ).toEqual([{ seq: 2, result: unavailable }]);
    expect(
      selectNessieResults(
        response([milestone(result(), 1), milestone({ broken: true }, 2)]),
        identity,
      ).results,
    ).toEqual([]);
    expect(
      selectNessieResults(
        response([
          milestone(result(), 1),
          milestone({ ...result(), profileId: "foreign" }, 2),
        ]),
        identity,
      ).results,
    ).toEqual([]);
  });
  test("selects only schema-valid saved output from the matching current attempt", () => {
    expect(selectNessieResults(response(), identity)).toMatchObject({
      contextChanged: false,
      results: [{ seq: 3, result: result() }],
    });
  });
  test.each([
    { investigationId: "inv-old" },
    { attempt: 1 },
    { projectId: "foreign" },
    { profileId: "old-profile" },
    { profileVersion: 0 },
    { synthetic: false },
  ])("rejects foreign, old or malformed saved identity %#", (change) => {
    expect(
      selectNessieResults(
        response([milestone({ ...result(), ...change })]),
        identity,
      ).results,
    ).toEqual([]);
  });
  test("ignores mismatched milestone identity, old attempts, other tools, strings and malformed summaries", () => {
    const raw = response([
      { ...milestone(), investigationId: "other" },
      milestone(result(), 1, "read_nessie_cash_buffer", 1),
      milestone(result(), 2, "evaluate_sites"),
      milestone(JSON.stringify(result()), 3),
      { ...milestone(), seq: 4, summary: result() },
      milestone(
        {
          ...result(),
          snapshot: { ...result().snapshot, netCashFlowCents: 900 },
        },
        5,
      ),
    ]);
    expect(selectNessieResults(raw, identity).results).toEqual([]);
  });
  test("fails closed when the response belongs to another job or the displayed live profile differs", () => {
    expect(
      selectNessieResults(
        { ...response(), job: { ...response().job, id: "other" } },
        identity,
      ).results,
    ).toEqual([]);
    expect(
      selectNessieResults(response(), {
        ...identity,
        profile: { id: "profile-2", version: 2 },
      }),
    ).toEqual({ results: [], contextChanged: true });
    expect(
      selectNessieResults(response(), {
        ...identity,
        profile: { id: "profile-1", version: 2 },
      }).results,
    ).toEqual([]);
  });
  test("uses the newest validated same-attempt profile snapshot rather than the initial job profile", () => {
    const next = { ...result(), profileId: "profile-2", profileVersion: 2 };
    const raw = response([
      milestone(result(), 1),
      milestone(
        { profileId: "profile-2", profileVersion: 2 },
        2,
        "save_profile",
      ),
      milestone(next, 3),
    ]);
    expect(
      selectNessieResults(raw, {
        ...identity,
        profile: { id: "profile-2", version: 2 },
      }).results,
    ).toEqual([{ seq: 3, result: next }]);
  });
  test("accepts an investigation-owned scenario without an external comparison and rejects missing evaluation evidence", () => {
    const withScenario = {
      ...result(),
      scenario: {
        comparisonId: "comparison-own",
        siteId: "site-1",
        modeledUpfrontBuildoutCents: 20_000,
        monthlyContributionUsd: { low: -200, mean: -100, high: 50 },
        projection: {
          cashAfterOneMonthCents: { low: 40_000, mean: 50_000, high: 65_000 },
          coverage: { kind: "burning" as const, months: 6 },
        },
      },
    };
    expect(
      selectNessieResults(response([milestone(withScenario)]), identity)
        .results,
    ).toEqual([]);
    const evaluation = milestone(
      {
        comparisonId: "comparison-own",
        profileId: "profile-1",
        siteIds: ["site-1"],
      },
      2,
      "evaluate_sites",
    );
    expect(
      selectNessieResults(
        response([evaluation, milestone(withScenario)]),
        identity,
      ).results,
    ).toHaveLength(1);
    expect(
      selectNessieResults(
        response([{ ...evaluation, attempt: 1 }, milestone(withScenario)]),
        identity,
      ).results,
    ).toEqual([]);
    expect(
      selectNessieResults(
        response([milestone(withScenario), { ...evaluation, seq: 4 }]),
        identity,
      ).results,
    ).toEqual([]);
  });
});
