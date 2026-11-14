import "server-only";
import {
  NessieConsultantResultSchema,
  type NessieConsultantResult,
  type NessieConsultantScenario,
} from "@/lib/contracts/nessie";
import { createNessieClient } from "./client";
import { createNessieSnapshot } from "./cash-flow";
import { projectCashBuffer } from "./projection";

export type NessieConsultantReadInput = Pick<
  NessieConsultantResult,
  "investigationId" | "attempt" | "projectId" | "profileId" | "profileVersion"
> & {
  accountId?: string;
  /** Trusted stored evaluation values assembled by the tool registry, never model arguments. */
  scenario?: Omit<NessieConsultantScenario, "projection">;
  signal: AbortSignal;
};

export function createNessieConsultantReader({
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
  return async function read(
    input: NessieConsultantReadInput,
  ): Promise<NessieConsultantResult> {
    input.signal.throwIfAborted();
    const identity = {
      investigationId: input.investigationId,
      attempt: input.attempt,
      projectId: input.projectId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    };
    const result = (patch: Partial<NessieConsultantResult>) =>
      NessieConsultantResultSchema.parse({
        ...identity,
        kind: "nessie_cash_buffer",
        source: "nessie",
        synthetic: true,
        status: "unconfigured",
        message:
          "Nessie simulated banking is unavailable; cash affordability cannot be verified from it.",
        accounts: [],
        selectedAccount: null,
        snapshot: null,
        scenario: null,
        ...patch,
      });
    const apiKey = env.NESSIE_API_KEY?.trim();
    if (!apiKey) return result({});
    let client: ReturnType<typeof createNessieClient> | undefined;
    try {
      client = createNessieClient({
        apiKey,
        baseUrl: env.NESSIE_BASE_URL?.trim() || undefined,
        fetcher,
        signal: input.signal,
        timeoutMs,
      });
      const accounts = await client.accounts();
      input.signal.throwIfAborted();
      if (!accounts.length)
        return result({
          status: "empty",
          message:
            "The shared Nessie mock sandbox has no checking or savings accounts, so it cannot supply a cash buffer. No accounts or transactions were created.",
        });
      const selectedAccount = input.accountId
        ? accounts.find((a) => a.id === input.accountId)
        : accounts.length === 1
          ? accounts[0]
          : undefined;
      if (!selectedAccount)
        return result({
          status: input.accountId
            ? "account_not_found"
            : "account_selection_required",
          accounts,
          message: input.accountId
            ? "That account is not a checking or savings account in the current shared Nessie demo sandbox. Choose one of the returned demo accounts."
            : "Several checking or savings accounts exist in the shared simulated sandbox. Which demo account should the consultant use? They were not summed or assigned to this business.",
        });
      const [transactions, bills] = await Promise.all([
        client.transactions(),
        client.bills(),
      ]);
      input.signal.throwIfAborted();
      const snapshot = createNessieSnapshot({
        accountId: selectedAccount.id,
        transactions,
        bills,
        asOf: now(),
      });
      let scenario: NessieConsultantScenario | null = null;
      if (input.scenario) {
        try {
          scenario = {
            ...input.scenario,
            projection: projectCashBuffer(
              selectedAccount.availableCents,
              input.scenario.modeledUpfrontBuildoutCents,
              input.scenario.monthlyContributionUsd,
            ),
          };
        } catch {
          return result({
            status: "comparison_unavailable",
            message:
              "The stored scenario cannot produce a safe cash calculation. Rerun the comparison with valid modeled buildout and contribution values.",
          });
        }
      }
      return result({
        status: "ready",
        accounts,
        selectedAccount,
        snapshot,
        scenario,
        message: `${input.accountId ? "Selected the requested demo account" : "Selected the sole checking or savings demo account"} ${selectedAccount.nickname || selectedAccount.id} in the shared Nessie simulated sandbox. This does not establish business ownership or connect a real bank account. Transfers/rewards are excluded; cash movements are not sales or profit. ${scenario ? "The cash scenario uses this stored site's modeled upfront buildout and operating contribution, not a forecast or the founder's budget." : "No site-affordability scenario was requested."}`,
      });
    } catch {
      input.signal.throwIfAborted();
      return result({
        status: "provider_error",
        message:
          "The simulated banking connection is unavailable; I could not verify the cash buffer. Continue without an affordability claim.",
      });
    } finally {
      client?.close();
    }
  };
}
