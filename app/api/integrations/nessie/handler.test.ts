import { describe, expect, it, vi } from "vitest";
import { createNessieHandler } from "./handler";
vi.mock("server-only", () => ({}));
const account = {
  id: "acct_demo",
  nickname: "Demo checking",
  type: "Checking",
  balance_cents: 10000,
  available_cents: 9000,
  account_number: "private-number",
  customer_id: "private-customer",
};
const now = () => new Date("2026-11-14T17:00:00Z");
const request = (query = "") =>
  new Request(`http://localhost/api/integrations/nessie${query}`);
const env = { NESSIE_API_KEY: "private-test-key" };
const fetcher: typeof fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  return Response.json({
    items:
      path === "/accounts"
        ? [account]
        : path === "/transactions"
          ? [
              {
                id: "tx_1",
                kind: "deposit",
                medium: "balance",
                status: "completed",
                amount_cents: 1000,
                payee_id: account.id,
                created_at: "2026-11-13T10:00:00Z",
              },
            ]
          : [
              {
                id: "bill_1",
                account_id: account.id,
                status: "pending",
                upcoming_payment_date: "2026-11-20",
                payment_amount: 1.23,
              },
            ],
  });
};
describe("Nessie integration GET", () => {
  it("works without configuration and makes no upstream request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const res = await createNessieHandler({ env: {}, fetcher })(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({
      status: "unconfigured",
      source: "nessie",
      synthetic: true,
      accounts: [],
      snapshot: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("loads sanitized accounts without fetching transactions until selected", async () => {
    const upstream = vi.fn(fetcher);
    const res = await createNessieHandler({ env, fetcher: upstream, now })(
      request(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.snapshot).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toMatch(
      /private-number|private-customer|private-test-key/,
    );
  });
  it("returns an account-specific snapshot from v2 data", async () => {
    const res = await createNessieHandler({ env, fetcher, now })(
      request("?accountId=acct_demo"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ready",
      snapshot: {
        accountId: "acct_demo",
        inflowCents: 1000,
        upcomingBillsCents: 123,
        asOf: now().toISOString(),
      },
    });
  });
  it("reports an empty sandbox without creating any data", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: null }));
    const res = await createNessieHandler({ env, fetcher: upstream })(
      request(),
    );
    expect(await res.json()).toMatchObject({
      status: "empty",
      accounts: [],
      snapshot: null,
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed/duplicate account IDs before talking to Nessie", async () => {
    const upstream = vi.fn<typeof fetch>();
    for (const query of [
      "?accountId=",
      "?accountId=acct_a&accountId=acct_b",
      "?accountId=../private",
      "?accountId=%20acct_a",
    ]) {
      const res = await createNessieHandler({ env, fetcher: upstream })(
        request(query),
      );
      expect(res.status).toBe(422);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("does not request data for unknown or credit-card accounts", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({
          items: [account, { ...account, id: "card", type: "Credit Card" }],
        }),
      );
    for (const id of ["missing", "card"]) {
      const res = await createNessieHandler({ env, fetcher: upstream })(
        request(`?accountId=${id}`),
      );
      expect(res.status).toBe(404);
    }
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("safely surfaces invalid keys, malformed provider data and timeout", async () => {
    const cases: [typeof fetch, number, string][] = [
      [
        async () => Response.json({ key: "private-test-key" }, { status: 401 }),
        503,
        "nessie_auth",
      ],
      [
        async () =>
          Response.json({ items: [{ ...account, available_cents: 1.1 }] }),
        502,
        "nessie_invalid_response",
      ],
      [async () => new Promise(() => {}), 504, "nessie_timeout"],
    ];
    for (const [fetcher, status, code] of cases) {
      const res = await createNessieHandler({ env, fetcher, timeoutMs: 10 })(
        request(),
      );
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("private-test-key");
    }
  });
  it("honors an already-cancelled request without fetching", async () => {
    const c = new AbortController();
    c.abort();
    const upstream = vi.fn<typeof fetch>();
    const res = await createNessieHandler({ env, fetcher: upstream })(
      new Request("http://localhost/api/integrations/nessie", {
        signal: c.signal,
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "nessie_cancelled" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
