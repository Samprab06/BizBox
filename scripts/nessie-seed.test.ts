import { describe, expect, it, vi } from "vitest";
import { seedNessieDemo, NessieSeedError } from "./nessie-seed";

const customer = {
  id: "cust_demo",
  first_name: "BizBox",
  last_name: "Simulated Demo",
  address: {
    street_number: "1",
    street_name: "Simulation Way",
    city: "Princeton",
    state: "NJ",
    zip: "08540",
  },
};
const account = {
  id: "acct_demo",
  customer_id: customer.id,
  type: "Checking",
  nickname: "BizBox Demo - simulated funds",
  balance_cents: 5000000,
  available_cents: 5000000,
  account_number: "private-account-number",
};
const env = { NESSIE_API_KEY: "private-test-v2-key" };
const page = (items: unknown[], next_cursor?: string) =>
  Response.json({ items, ...(next_cursor ? { next_cursor } : {}) });
function sandbox(initialCustomer = false, initialAccount = false) {
  const customers: unknown[] = initialCustomer ? [customer] : [];
  const accounts: unknown[] = initialAccount ? [account] : [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "GET")
      return page(path === "/customers" ? customers : accounts);
    if (path === "/customers") {
      customers.push(customer);
      return Response.json(customer, { status: 201 });
    }
    accounts.push(account);
    return Response.json(account, { status: 201 });
  });
  return { fetcher, customers, accounts };
}
const run = (
  fetcher: typeof fetch,
  options: Partial<Parameters<typeof seedNessieDemo>[0]> = {},
) =>
  seedNessieDemo({
    argv: ["--confirm"],
    env,
    fetcher,
    print: () => {},
    ...options,
  });

describe("guarded Nessie demo seed CLI", () => {
  it("refuses missing confirmation, unknown/conflicting/duplicate flags and all CI execution before any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const argv of [
      [],
      ["--force"],
      ["--confirm", "--dry-run"],
      ["--confirm", "--confirm"],
      ["--confirm", "--key=private"],
    ])
      await expect(run(fetcher, { argv })).rejects.toBeInstanceOf(
        NessieSeedError,
      );
    for (const CI of ["true", "1", "false"])
      await expect(run(fetcher, { env: { ...env, CI } })).rejects.toMatchObject(
        { code: "ci_forbidden" },
      );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("dry-run is offline/keyless and reports the exact synthetic target without reading provider data", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const print = vi.fn();
    const result = await run(fetcher, { argv: ["--dry-run"], env: {}, print });
    expect(result).toMatchObject({
      mode: "dry-run",
      synthetic: true,
      targetCustomers: 1,
      targetCheckingAccounts: 1,
      initialBalanceCents: 5000000,
      networkRequests: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0]![0]).toContain('"synthetic":true');
  });
  it("validates key and exact HTTPS target before even listing data", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(run(fetcher, { env: {} })).rejects.toMatchObject({
      code: "missing_key",
    });
    for (const base of [
      "http://v2-prod-api.nessieisreal.com",
      "https://evil.example",
      "https://v2-prod-api.nessieisreal.com/path",
      "https://user:pass@v2-prod-api.nessieisreal.com",
      "https://v2-prod-api.nessieisreal.com?key=private",
      "https://v2-prod-api.nessieisreal.com/#other",
    ])
      await expect(
        run(fetcher, { env: { ...env, NESSIE_BASE_URL: base } }),
      ).rejects.toMatchObject({ code: "invalid_target" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("creates only one dedicated fictional customer and one checking account with simulated initial funds", async () => {
    const f = sandbox();
    const print = vi.fn();
    const result = await run(f.fetcher, { print });
    expect(result).toEqual({
      mode: "seeded",
      synthetic: true,
      customer: "created",
      account: "created",
      accountId: "acct_demo",
    });
    const writes = f.fetcher.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(writes).toHaveLength(2);
    expect(new URL(String(writes[0]![0])).pathname).toBe("/customers");
    expect(JSON.parse(String(writes[0]![1]?.body))).toEqual({
      first_name: customer.first_name,
      last_name: customer.last_name,
      address: customer.address,
    });
    expect(new URL(String(writes[1]![0])).pathname).toBe(
      `/customers/${customer.id}/accounts`,
    );
    expect(JSON.parse(String(writes[1]![1]?.body))).toEqual({
      type: "Checking",
      nickname: account.nickname,
      balance_cents: 5000000,
    });
    for (const [url, init] of f.fetcher.mock.calls) {
      expect(String(url)).not.toContain(env.NESSIE_API_KEY);
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${env.NESSIE_API_KEY}`,
      });
      expect(init?.redirect).toBe("error");
    }
    expect(print.mock.calls[0]![0]).not.toMatch(
      /private-test|private-account|Simulation Way|Simulated Demo|08540/,
    );
  });
  it("reuses the same dedicated objects without resetting/top-up, preserves other data, and makes no writes", async () => {
    const f = sandbox(true, true);
    f.accounts[0] = { ...account, balance_cents: 1234, available_cents: -100 };
    f.customers.push({ ...customer, id: "unrelated", first_name: "Other" });
    f.accounts.push({
      ...account,
      id: "other",
      customer_id: "unrelated",
      nickname: "Other account",
    });
    expect(await run(f.fetcher)).toMatchObject({
      customer: "reused",
      account: "reused",
      accountId: account.id,
    });
    expect(
      f.fetcher.mock.calls.every(([, init]) => init?.method === "GET"),
    ).toBe(true);
    expect(f.accounts).toHaveLength(2);
    expect(f.accounts[0]).toMatchObject({ balance_cents: 1234 });
  });
  it("recovers an existing demo customer after partial completion by creating only its missing account", async () => {
    const f = sandbox(true);
    expect(await run(f.fetcher)).toMatchObject({
      customer: "reused",
      account: "created",
    });
    const writes = f.fetcher.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(writes).toHaveLength(1);
    expect(new URL(String(writes[0]![0])).pathname).toBe(
      `/customers/${customer.id}/accounts`,
    );
  });
  it("refuses duplicate customers, conflicting identities and ambiguous/cross-owner nickname collisions without writes", async () => {
    const cases = [
      { customers: [customer, { ...customer, id: "duplicate" }], accounts: [] },
      {
        customers: [
          { ...customer, address: { ...customer.address, zip: "00000" } },
        ],
        accounts: [],
      },
      {
        customers: [customer],
        accounts: [account, { ...account, id: "duplicate" }],
      },
      {
        customers: [customer],
        accounts: [{ ...account, customer_id: "someone_else" }],
      },
      { customers: [], accounts: [account] },
      { customers: [customer], accounts: [{ ...account, type: "Savings" }] },
    ];
    for (const c of cases) {
      const fetcher = vi.fn<typeof fetch>(async (url) =>
        page(
          new URL(String(url)).pathname === "/customers"
            ? c.customers
            : c.accounts,
        ),
      );
      await expect(run(fetcher)).rejects.toMatchObject({
        code: "ambiguous_demo",
      });
      expect(
        fetcher.mock.calls.every(([, init]) => init?.method === "GET"),
      ).toBe(true);
    }
  });
  it("follows opaque pagination before deciding whether anything needs creating", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get("limit")).toBe("100");
      return parsed.searchParams.has("cursor")
        ? page(parsed.pathname === "/customers" ? [customer] : [account])
        : page([], "opaque&next=?");
    });
    expect(await run(fetcher)).toMatchObject({ account: "reused" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      new URL(String(fetcher.mock.calls[1]![0])).searchParams.get("cursor"),
    ).toBe("opaque&next=?");
  });
  it("rejects cursor cycles/page caps and malformed GET data before writes", async () => {
    for (const body of [
      { items: [], next_cursor: "cycle" },
      { items: [{ ...customer, id: "bad/id" }] },
      { records: [] },
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(body));
      await expect(run(fetcher)).rejects.toMatchObject({
        code: "invalid_response",
      });
      expect(
        fetcher.mock.calls.every(([, init]) => init?.method === "GET"),
      ).toBe(true);
    }
    let n = 0;
    const fetcher = vi.fn<typeof fetch>(async () => page([], String(++n)));
    await expect(run(fetcher)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(fetcher).toHaveBeenCalledTimes(20);
  });
  it("recovers an uncertain customer POST on the next explicit invocation without duplicating that customer", async () => {
    const f = sandbox();
    let attempted = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (
        init?.method === "POST" &&
        new URL(String(url)).pathname === "/customers" &&
        !attempted
      ) {
        attempted = true;
        f.customers.push(customer);
        throw new Error("Private uncertain response");
      }
      return f.fetcher(url, init);
    });
    await expect(run(fetcher)).rejects.toMatchObject({
      code: "uncertain_write",
    });
    expect(f.accounts).toHaveLength(0);
    expect(f.customers).toHaveLength(1);
    expect(await run(fetcher)).toMatchObject({
      customer: "reused",
      account: "created",
    });
    expect(
      fetcher.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          new URL(String(url)).pathname === "/customers",
      ),
    ).toHaveLength(1);
  });
  it("accepts null inventory pages but stops after malformed create responses without a second write", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === "GET"
        ? Response.json({ items: null })
        : Response.json({ private: env.NESSIE_API_KEY }),
    );
    await expect(run(fetcher)).rejects.toMatchObject({
      code: "uncertain_write",
    });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("does not retry an uncertain account POST; the next explicit run re-lists and reuses it", async () => {
    const f = sandbox(true);
    let attempted = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST" && !attempted) {
        attempted = true;
        f.accounts.push(account);
        throw new Error("private-key-in-network-error");
      }
      return f.fetcher(url, init);
    });
    await expect(run(fetcher)).rejects.toMatchObject({
      code: "uncertain_write",
    });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(await run(fetcher)).toMatchObject({
      customer: "reused",
      account: "reused",
    });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("bounds hung reads/bodies and uncertain writes, with no raw provider errors or secrets", async () => {
    for (const fetcher of [
      async () => new Promise<Response>(() => {}),
      async () =>
        ({ ok: true, json: async () => new Promise(() => {}) }) as Response,
    ])
      await expect(run(fetcher, { timeoutMs: 10 })).rejects.toMatchObject({
        code: "timeout",
      });
    const f = sandbox(true);
    const timeoutPost: typeof fetch = async (url, init) =>
      init?.method === "POST" ? new Promise(() => {}) : f.fetcher(url, init);
    await expect(run(timeoutPost, { timeoutMs: 10 })).rejects.toMatchObject({
      code: "uncertain_write",
    });
    for (const fetcher of [
      async () => Response.json({ key: env.NESSIE_API_KEY }, { status: 401 }),
      async () => {
        throw new Error(env.NESSIE_API_KEY);
      },
    ]) {
      try {
        await run(fetcher);
        throw new Error("Expected failure");
      } catch (e) {
        expect(e).toBeInstanceOf(NessieSeedError);
        expect(String(e)).not.toContain(env.NESSIE_API_KEY);
      }
    }
  });
});
