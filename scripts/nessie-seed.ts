import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

const NESSIE_ORIGIN = "https://v2-prod-api.nessieisreal.com";
const INITIAL_BALANCE_CENTS = 5_000_000;
const DEMO_CUSTOMER = {
  first_name: "BizBox",
  last_name: "Simulated Demo",
  address: {
    street_number: "1",
    street_name: "Simulation Way",
    city: "Princeton",
    state: "NJ",
    zip: "08540",
  },
} as const;
const DEMO_NICKNAME = "BizBox Demo - simulated funds";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const AddressSchema = z.object({
  street_number: z.string().max(12),
  street_name: z.string().max(80),
  city: z.string().max(80),
  state: z.string().length(2),
  zip: z.string().regex(/^\d{5}$/),
});
const CustomerSchema = z.object({
  id: identifier,
  first_name: z.string().max(80),
  last_name: z.string().max(80),
  address: AddressSchema,
});
const AccountSchema = z.object({
  id: identifier,
  customer_id: identifier,
  type: z.enum(["Checking", "Savings", "Credit Card"]),
  nickname: z.string().max(40),
  balance_cents: z.number().int().safe(),
  available_cents: z.number().int().safe(),
});

export class NessieSeedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NessieSeedError";
  }
}
const invalid = () =>
  new NessieSeedError(
    "invalid_response",
    "Nessie returned incomplete or inconsistent data. No further seed requests were attempted.",
  );
const uncertain = () =>
  new NessieSeedError(
    "uncertain_write",
    "A Nessie demo create request may have completed. Stopped without retrying or changing balances. A later explicit seed invocation will re-list and reuse matching demo objects; inspect the sandbox if uncertainty persists.",
  );
const ambiguous = () =>
  new NessieSeedError(
    "ambiguous_demo",
    "The dedicated simulated demo identity or account is ambiguous. Stopped without writing; review duplicate customers or conflicting account ownership/nicknames in Nessie.",
  );

function modeFor(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): "confirm" | "dry-run" {
  if (env.CI?.trim())
    throw new NessieSeedError(
      "ci_forbidden",
      "Nessie seeding is forbidden in CI, including with --confirm.",
    );
  if (argv.length !== 1 || !["--confirm", "--dry-run"].includes(argv[0]!))
    throw new NessieSeedError(
      "usage",
      "Usage: pnpm nessie:seed --confirm for guarded simulated sandbox writes, or pnpm nessie:seed --dry-run for an offline plan. No request was made.",
    );
  return argv[0] === "--confirm" ? "confirm" : "dry-run";
}

type SeedResult = {
  mode: "seeded";
  synthetic: true;
  customer: "created" | "reused";
  account: "created" | "reused";
  accountId: string;
};
type DryRunResult = {
  mode: "dry-run";
  synthetic: true;
  targetCustomers: 1;
  targetCheckingAccounts: 1;
  initialBalanceCents: 5000000;
  networkRequests: 0;
};

/**
 * Explicit operator-only helper, never invoked by the app/build/CI. Re-listing
 * makes sequential invocations reusable, not globally atomic: the provider has
 * no idempotency token or cross-process lock, so concurrent runs are unsupported.
 */
export async function seedNessieDemo({
  argv,
  env = process.env,
  fetcher = fetch,
  print = console.log,
  timeoutMs = 20_000,
}: {
  argv: readonly string[];
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  print?: (message: string) => void;
  timeoutMs?: number;
}): Promise<SeedResult | DryRunResult> {
  const mode = modeFor(argv, env);
  if (mode === "dry-run") {
    const result: DryRunResult = {
      mode: "dry-run",
      synthetic: true,
      targetCustomers: 1,
      targetCheckingAccounts: 1,
      initialBalanceCents: INITIAL_BALANCE_CENTS,
      networkRequests: 0,
    };
    print(JSON.stringify(result));
    return result;
  }
  const apiKey = env.NESSIE_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey))
    throw new NessieSeedError(
      "missing_key",
      "A valid server-only Nessie v2 key is required in NESSIE_API_KEY. No request was made.",
    );
  let base: URL;
  try {
    base = new URL(env.NESSIE_BASE_URL?.trim() || NESSIE_ORIGIN);
    if (
      base.origin !== NESSIE_ORIGIN ||
      base.pathname !== "/" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error();
  } catch {
    throw new NessieSeedError(
      "invalid_target",
      "The seed target must be exactly the HTTPS Nessie v2 sandbox origin. No request was made.",
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new NessieSeedError(
      "invalid_timeout",
      "The seed deadline must be between 1 and 60000 milliseconds. No request was made.",
    );
  const controller = new AbortController();
  const deadlineError = () =>
    new NessieSeedError(
      "timeout",
      "Nessie demo seed deadline expired. Stopped without retrying requests.",
    );
  const timer = setTimeout(() => controller.abort(deadlineError()), timeoutMs);

  async function bounded<T>(work: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw deadlineError();
    let listener: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      listener = () => reject(deadlineError());
      controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([work(), aborted]);
    } finally {
      if (listener) controller.signal.removeEventListener("abort", listener);
    }
  }
  async function request(
    method: "GET" | "POST",
    url: URL,
    body?: unknown,
  ): Promise<unknown> {
    if (controller.signal.aborted) throw deadlineError();
    try {
      const response = await bounded(() =>
        fetcher(url, {
          method,
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            ...(method === "POST"
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        }),
      );
      if (!response.ok)
        throw new NessieSeedError(
          "provider_unavailable",
          "Nessie could not authorize or complete this seed request. Stopped without retrying; no provider details were printed.",
        );
      return await bounded(() => response.json());
    } catch (error) {
      if (method === "POST") throw uncertain();
      if (error instanceof NessieSeedError) throw error;
      throw new NessieSeedError(
        "provider_unavailable",
        "Nessie could not return valid seed data. Stopped without retrying; no provider details were printed.",
      );
    }
  }
  async function list<S extends z.ZodType<{ id: string }>>(
    path: "/customers" | "/accounts",
    schema: S,
  ): Promise<z.output<S>[]> {
    const Page = z.object({
      items: z.array(schema).nullable(),
      next_cursor: z.string().max(4096).optional(),
    });
    const rows = new Map<string, z.output<S>>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 20; n++) {
      const url = new URL(path, base);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const parsed = Page.safeParse(await request("GET", url));
      if (!parsed.success) throw invalid();
      for (const row of parsed.data.items ?? []) {
        const old = rows.get(row.id);
        if (old && JSON.stringify(old) !== JSON.stringify(row)) throw invalid();
        rows.set(row.id, row);
      }
      const next = parsed.data.next_cursor;
      if (!next) return [...rows.values()];
      if (cursors.has(next)) throw invalid();
      cursors.add(next);
      cursor = next;
    }
    throw invalid();
  }
  async function create<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.output<S>> {
    const parsed = schema.safeParse(
      await request("POST", new URL(path, base), body),
    );
    if (!parsed.success) throw uncertain();
    return parsed.data;
  }
  const isDemoName = (customer: z.output<typeof CustomerSchema>) =>
    customer.first_name === DEMO_CUSTOMER.first_name &&
    customer.last_name === DEMO_CUSTOMER.last_name;
  const isExactCustomer = (customer: z.output<typeof CustomerSchema>) =>
    isDemoName(customer) &&
    (
      Object.keys(
        DEMO_CUSTOMER.address,
      ) as (keyof typeof DEMO_CUSTOMER.address)[]
    ).every(
      (field) => customer.address[field] === DEMO_CUSTOMER.address[field],
    );
  try {
    // Complete both inventories before creating anything: absence on page one
    // is not proof of absence, and a cross-owner nickname must never be reused.
    const customers = await list("/customers", CustomerSchema);
    const accounts = await list("/accounts", AccountSchema);
    const matches = customers.filter(isDemoName);
    if (
      matches.length > 1 ||
      (matches.length === 1 && !isExactCustomer(matches[0]!))
    )
      throw ambiguous();
    const matchingAccounts = accounts.filter(
      (account) => account.nickname === DEMO_NICKNAME,
    );
    if (matchingAccounts.length > 1) throw ambiguous();
    let customer = matches[0];
    let account = matchingAccounts[0];
    if (
      account &&
      (!customer ||
        account.customer_id !== customer.id ||
        account.type !== "Checking")
    )
      throw ambiguous();
    const customerStatus = customer ? "reused" : "created";
    if (!customer) {
      customer = await create("/customers", DEMO_CUSTOMER, CustomerSchema);
      if (!isExactCustomer(customer)) throw uncertain();
    }
    const accountStatus = account ? "reused" : "created";
    if (!account) {
      account = await create(
        `/customers/${encodeURIComponent(customer.id)}/accounts`,
        {
          type: "Checking",
          nickname: DEMO_NICKNAME,
          balance_cents: INITIAL_BALANCE_CENTS,
        },
        AccountSchema,
      );
      if (
        account.customer_id !== customer.id ||
        account.type !== "Checking" ||
        account.nickname !== DEMO_NICKNAME ||
        account.balance_cents !== INITIAL_BALANCE_CENTS
      )
        throw uncertain();
    }
    if (account.id.includes(apiKey)) throw invalid();
    const result: SeedResult = {
      mode: "seeded",
      synthetic: true,
      customer: customerStatus,
      account: accountStatus,
      accountId: account.id,
    };
    print(JSON.stringify(result));
    return result;
  } catch (error) {
    if (error instanceof NessieSeedError) throw error;
    throw new NessieSeedError(
      "seed_failed",
      "Nessie demo seed stopped safely. No provider details were printed. Inspect the dedicated demo objects before another explicit invocation.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void (async () => {
    const argv = process.argv.slice(2);
    const mode = modeFor(argv, process.env);
    // Do not load a key for an offline dry-run. Imports never read env files.
    if (mode === "confirm")
      config({ path: [".env.local", ".env"], quiet: true });
    await seedNessieDemo({ argv });
  })().catch((error: unknown) => {
    console.error(
      error instanceof NessieSeedError
        ? error.message
        : "Nessie demo seed stopped safely. No provider details were printed.",
    );
    process.exitCode = 1;
  });
}
