import {
  NessieCashFlowResponseSchema,
  type NessieCashFlowResponse,
} from "@/lib/contracts/nessie";
import { createNessieClient, NessieError } from "@/lib/nessie/client";
import { createNessieSnapshot } from "@/lib/nessie/cash-flow";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const success = (body: Omit<NessieCashFlowResponse, "source" | "synthetic">) =>
  json(
    NessieCashFlowResponseSchema.parse({
      ...body,
      source: "nessie",
      synthetic: true,
    }),
  );

export function createNessieHandler({
  env = process.env,
  fetcher = fetch,
  now = () => new Date(),
  timeoutMs = 12_000,
}: {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
} = {}) {
  return async function GET(request: Request): Promise<Response> {
    const values = new URL(request.url).searchParams.getAll("accountId");
    if (
      values.length > 1 ||
      (values.length === 1 && !/^[A-Za-z0-9_-]{1,128}$/.test(values[0]))
    )
      return json(
        {
          code: "nessie_invalid_account",
          message: "Choose one valid simulated bank account.",
        },
        422,
      );
    const accountId = values[0];
    const apiKey = env.NESSIE_API_KEY?.trim();
    if (!apiKey)
      return success({
        status: "unconfigured",
        accounts: [],
        snapshot: null,
        message:
          "Nessie simulated banking is not connected. Add a Nessie v2 key to the server configuration to enable the cash buffer.",
      });
    let client: ReturnType<typeof createNessieClient> | undefined;
    try {
      client = createNessieClient({
        apiKey,
        baseUrl: env.NESSIE_BASE_URL?.trim() || undefined,
        fetcher,
        signal: request.signal,
        timeoutMs,
      });
      const accounts = await client.accounts();
      if (accountId && !accounts.some((a) => a.id === accountId))
        return json(
          {
            code: "nessie_account_not_found",
            message:
              "This checking or savings account is not available in the configured Nessie sandbox. Refresh the account list.",
          },
          404,
        );
      if (!accounts.length)
        return success({
          status: "empty",
          accounts: [],
          snapshot: null,
          message:
            "This Nessie sandbox has no checking or savings accounts yet. Create demo banking data in Nessie, then refresh. BizBox does not create accounts automatically.",
        });
      if (!accountId)
        return success({
          status: "ready",
          accounts,
          snapshot: null,
          message:
            "Choose a checking or savings account from the shared Nessie demo sandbox. These are simulated funds, not a connected business bank account.",
        });
      const [transactions, bills] = await Promise.all([
        client.transactions(),
        client.bills(),
      ]);
      const snapshot = createNessieSnapshot({
        accountId,
        transactions,
        bills,
        asOf: now(),
      });
      return success({
        status: "ready",
        accounts,
        snapshot,
        message:
          "Simulated cash movements from Capital One Nessie. Transfers and rewards are excluded; this is not sales or profit evidence.",
      });
    } catch (error) {
      const safe =
        error instanceof NessieError
          ? error
          : new NessieError(
              "nessie_invalid_response",
              "Nessie returned unsupported banking data. Try refreshing later.",
            );
      return json({ code: safe.code, message: safe.message }, safe.status);
    } finally {
      client?.close();
    }
  };
}
