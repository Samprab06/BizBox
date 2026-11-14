import { describe, expect, it, vi } from "vitest";
import {
  createNessieConsultantReader,
  type NessieConsultantReadInput,
} from "./consultant";
vi.mock("server-only", () => ({}));
const account = {
  id: "acct_a",
  nickname: "Demo A",
  type: "Checking",
  balance_cents: 200000,
  available_cents: 180000,
};
const identity = {
  investigationId: "job1",
  attempt: 1,
  projectId: "project1",
  profileId: "profile1",
  profileVersion: 1,
};
const input = (
  extra: Partial<NessieConsultantReadInput> = {},
): NessieConsultantReadInput => ({
  ...identity,
  signal: new AbortController().signal,
  ...extra,
});
const transport =
  (accounts: unknown[] = [account]): typeof fetch =>
  async (url) =>
    Response.json({
      items: new URL(String(url)).pathname === "/accounts" ? accounts : [],
    });
describe("Nessie consultant evidence service", () => {
  it("selects the sole demo account and derives projection from server supplied scenario", async () => {
    const result = await createNessieConsultantReader({
      env: { NESSIE_API_KEY: "test" },
      fetcher: transport(),
      now: () => new Date("2026-11-14T17:00:00Z"),
    })(
      input({
        scenario: {
          comparisonId: "cmp1",
          siteId: "101:1",
          modeledUpfrontBuildoutCents: 100000,
          monthlyContributionUsd: { low: -200, mean: -100, high: 0 },
        },
      }),
    );
    expect(result).toMatchObject({
      ...identity,
      status: "ready",
      source: "nessie",
      synthetic: true,
      selectedAccount: { id: "acct_a" },
      snapshot: { accountId: "acct_a" },
      scenario: {
        modeledUpfrontBuildoutCents: 100000,
        projection: {
          cashAfterOneMonthCents: { low: 60000, mean: 70000, high: 80000 },
          coverage: { kind: "burning", months: 8 },
        },
      },
    });
    expect(result.message).toMatch(/sole.*demo account/i);
  });
  it("asks for an account rather than guessing/summing several accounts", async () => {
    const fetcher = vi.fn(transport([account, { ...account, id: "acct_b" }]));
    const result = await createNessieConsultantReader({
      env: { NESSIE_API_KEY: "test" },
      fetcher,
    })(input());
    expect(result.status).toBe("account_selection_required");
    expect(result.accounts).toHaveLength(2);
    expect(result.snapshot).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows a listed explicit choice but refuses foreign accounts without financial reads", async () => {
    const fetcher = vi.fn(transport([account, { ...account, id: "acct_b" }]));
    const read = createNessieConsultantReader({
      env: { NESSIE_API_KEY: "test" },
      fetcher,
    });
    expect(
      (await read(input({ accountId: "acct_b" }))).selectedAccount?.id,
    ).toBe("acct_b");
    fetcher.mockClear();
    expect((await read(input({ accountId: "foreign" }))).status).toBe(
      "account_not_found",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps missing keys, empty sandboxes and provider rejection nonfatal and honest", async () => {
    const unconfigured = await createNessieConsultantReader({ env: {} })(
      input(),
    );
    expect(unconfigured).toMatchObject({
      status: "unconfigured",
      scenario: null,
      snapshot: null,
    });
    expect(
      (
        await createNessieConsultantReader({
          env: { NESSIE_API_KEY: "test" },
          fetcher: transport([]),
        })(input())
      ).status,
    ).toBe("empty");
    const failure = await createNessieConsultantReader({
      env: { NESSIE_API_KEY: "private-key" },
      fetcher: async () =>
        Response.json({ private: "private-key" }, { status: 401 }),
    })(input());
    expect(failure.status).toBe("provider_error");
    expect(JSON.stringify(failure)).not.toContain("private-key");
  });
  it("does not swallow investigation cancellation", async () => {
    const c = new AbortController();
    c.abort(new Error("Investigation cancelled"));
    await expect(
      createNessieConsultantReader({ env: {} })(input({ signal: c.signal })),
    ).rejects.toThrow("Investigation cancelled");
  });
});
