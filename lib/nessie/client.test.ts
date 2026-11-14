import { describe, expect, it, vi } from "vitest";
import { createNessieClient, NessieError } from "./client";
vi.mock("server-only", () => ({}));
const account = {
  id: "acct_a",
  nickname: "Demo",
  type: "Checking",
  balance_cents: 10000,
  available_cents: 9000,
  account_number: "must-not-leak",
};
const response = (body: unknown, status = 200) =>
  Response.json(body, { status });
describe("Nessie read-only v2 client", () => {
  it("uses bearer auth/no-store and traverses opaque cursors without leaking DTO fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ items: [account], next_cursor: "opaque?next&=" }),
      )
      .mockResolvedValueOnce(response({ items: null }));
    const client = createNessieClient({ apiKey: "test-private-key", fetcher });
    const accounts = await client.accounts();
    expect(accounts).toEqual([
      {
        id: "acct_a",
        nickname: "Demo",
        type: "Checking",
        balanceCents: 10000,
        availableCents: 9000,
      },
    ]);
    const [first, init] = fetcher.mock.calls[0];
    expect(String(first)).toBe(
      "https://v2-prod-api.nessieisreal.com/accounts?limit=100",
    );
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Authorization: "Bearer test-private-key" },
    });
    expect(
      new URL(String(fetcher.mock.calls[1][0])).searchParams.get("cursor"),
    ).toBe("opaque?next&=");
    expect(JSON.stringify(accounts)).not.toContain("must-not-leak");
    client.close();
  });
  it("excludes credit cards while preserving negative bank balances", async () => {
    const client = createNessieClient({
      apiKey: "test",
      fetcher: async () =>
        response({
          items: [
            account,
            { ...account, id: "card", type: "Credit Card" },
            {
              ...account,
              id: "negative",
              balance_cents: -1,
              available_cents: -10,
            },
          ],
        }),
    });
    expect(await client.accounts()).toHaveLength(2);
    client.close();
  });
  it("rejects repeated cursors, page overflow and conflicting duplicate account IDs", async () => {
    for (const body of [
      { items: [account], next_cursor: "cycle" },
      { items: [account, { ...account, available_cents: 1 }] },
    ]) {
      const client = createNessieClient({
        apiKey: "test",
        fetcher: async () => response(body),
      });
      await expect(client.accounts()).rejects.toMatchObject({
        code: "nessie_invalid_response",
      });
      client.close();
    }
    let i = 0;
    const client = createNessieClient({
      apiKey: "test",
      fetcher: async () => response({ items: [], next_cursor: String(++i) }),
    });
    await expect(client.accounts()).rejects.toMatchObject({
      code: "nessie_invalid_response",
    });
    expect(i).toBe(20);
    client.close();
  });
  it("rejects untrusted base URLs before credentials can leave", () => {
    for (const baseUrl of [
      "http://v2-prod-api.nessieisreal.com",
      "https://evil.example",
      "https://v2-prod-api.nessieisreal.com/path",
      "https://user:pass@v2-prod-api.nessieisreal.com",
      "https://v2-prod-api.nessieisreal.com?key=x",
    ])
      expect(() => createNessieClient({ apiKey: "test", baseUrl })).toThrow(
        NessieError,
      );
  });
  it("maps auth, rate limit, invalid JSON and network failures to safe messages", async () => {
    for (const fetcher of [
      async () => response({ secret: "raw-secret" }, 401),
      async () => response({}, 429),
      async () => new Response("not json"),
      async () => {
        throw new Error("raw-secret");
      },
    ]) {
      const client = createNessieClient({ apiKey: "private-key", fetcher });
      try {
        await client.accounts();
        throw new Error("Expected failure");
      } catch (e) {
        expect(e).toBeInstanceOf(NessieError);
        expect(String(e)).not.toMatch(/raw-secret|private-key/);
      } finally {
        client.close();
      }
    }
  });
  it("bounds response-body reads and aborts work when the request closes", async () => {
    const delayedBody = {
      ok: true,
      json: async () => new Promise(() => {}),
    } as Response;
    const bodyClient = createNessieClient({
      apiKey: "test",
      fetcher: async () => delayedBody,
      timeoutMs: 10,
    });
    await expect(bodyClient.accounts()).rejects.toMatchObject({
      code: "nessie_timeout",
    });
    bodyClient.close();
    const closingClient = createNessieClient({
      apiKey: "test",
      fetcher: async () => new Promise(() => {}),
    });
    const reading = closingClient.accounts();
    closingClient.close();
    await expect(reading).rejects.toMatchObject({ code: "nessie_cancelled" });
  });
  it("bounds a hung fetch and honors caller cancellation", async () => {
    const hung: typeof fetch = async () => new Promise(() => {});
    const client = createNessieClient({
      apiKey: "test",
      fetcher: hung,
      timeoutMs: 10,
    });
    await expect(client.accounts()).rejects.toMatchObject({
      code: "nessie_timeout",
      status: 504,
    });
    client.close();
    const controller = new AbortController();
    controller.abort();
    const cancelled = createNessieClient({
      apiKey: "test",
      signal: controller.signal,
      fetcher: hung,
    });
    await expect(cancelled.accounts()).rejects.toMatchObject({
      code: "nessie_cancelled",
    });
    cancelled.close();
  });
});
