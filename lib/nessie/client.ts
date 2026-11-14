import "server-only";
import { z } from "zod";
import type { NessieAccount } from "@/lib/contracts/nessie";
import {
  NessieBillSchema,
  NessieTransactionSchema,
  uniqueNessieRecords,
} from "./cash-flow";

export const DEFAULT_NESSIE_BASE_URL = "https://v2-prod-api.nessieisreal.com";
const AccountSchema = z.object({
  id: z.string().min(1),
  nickname: z.string(),
  type: z.enum(["Checking", "Savings", "Credit Card"]),
  balance_cents: z.number().int().safe(),
  available_cents: z.number().int().safe(),
});

export class NessieError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "NessieError";
  }
}
const invalid = () =>
  new NessieError(
    "nessie_invalid_response",
    "Nessie returned incomplete or unsupported banking data. Try refreshing later.",
  );
const cancelled = () =>
  new NessieError("nessie_cancelled", "The Nessie request was cancelled.", 503);

export function createNessieClient({
  apiKey,
  baseUrl = DEFAULT_NESSIE_BASE_URL,
  fetcher = fetch,
  signal,
  timeoutMs = 12_000,
}: {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  let base: URL;
  try {
    base = new URL(baseUrl);
    if (
      base.origin !== DEFAULT_NESSIE_BASE_URL ||
      base.pathname !== "/" ||
      base.search ||
      base.hash ||
      base.username ||
      base.password
    )
      throw new Error();
  } catch {
    throw new NessieError(
      "nessie_configuration",
      "Nessie v2 is not configured correctly.",
      503,
    );
  }
  if (!apiKey.trim())
    throw new NessieError(
      "nessie_configuration",
      "A Nessie v2 key is required.",
      503,
    );
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new NessieError(
      "nessie_configuration",
      "Nessie timeout configuration is invalid.",
      503,
    );
  const controller = new AbortController();
  const onCancel = () => controller.abort(cancelled());
  if (signal?.aborted) onCancel();
  else signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new NessieError(
          "nessie_timeout",
          "Nessie took too long to respond. Try again.",
          504,
        ),
      ),
    timeoutMs,
  );

  function abortError(): NessieError {
    return controller.signal.reason instanceof NessieError
      ? controller.signal.reason
      : cancelled();
  }
  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw abortError();
    let listener: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      listener = () => reject(abortError());
      controller.signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      if (listener) controller.signal.removeEventListener("abort", listener);
    }
  }

  async function readPage(
    path: string,
    limit: number,
    cursor?: string,
  ): Promise<unknown> {
    const url = new URL(path, base);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    try {
      const response = await bounded(() =>
        fetcher(url, {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
          signal: controller.signal,
        }),
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new NessieError(
            "nessie_auth",
            "Nessie rejected the configured key. Use a Nessie v2 key from v2.nessieisreal.com/account and restart the local app.",
            503,
          );
        if (response.status === 429 || response.status === 503)
          throw new NessieError(
            "nessie_unavailable",
            "Nessie is temporarily unavailable. Try again later.",
            503,
          );
        throw new NessieError(
          "nessie_upstream",
          "Nessie could not complete the banking request. Try again later.",
        );
      }
      return await bounded(() => response.json());
    } catch (error) {
      if (error instanceof NessieError) throw error;
      if (controller.signal.aborted) throw abortError();
      throw new NessieError(
        "nessie_upstream",
        "Nessie could not return valid banking data. Try again later.",
      );
    }
  }

  async function list<S extends z.ZodType<{ id: string }>>(
    path: string,
    schema: S,
    limit: number,
  ): Promise<z.output<S>[]> {
    const pageSchema = z.object({
      items: z.array(schema).nullable(),
      next_cursor: z.string().optional(),
    });
    const rows: z.output<S>[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const parsed = pageSchema.safeParse(await readPage(path, limit, cursor));
      if (!parsed.success) throw invalid();
      rows.push(...(parsed.data.items ?? []));
      const next = parsed.data.next_cursor;
      if (!next) {
        try {
          return uniqueNessieRecords(rows);
        } catch {
          throw invalid();
        }
      }
      if (seenCursors.has(next)) throw invalid();
      seenCursors.add(next);
      cursor = next;
    }
    throw invalid();
  }

  return {
    async accounts(): Promise<NessieAccount[]> {
      const rows = await list("/accounts", AccountSchema, 100);
      return rows.flatMap((a) =>
        a.type === "Credit Card"
          ? []
          : [
              {
                id: a.id,
                nickname: a.nickname,
                type: a.type,
                balanceCents: a.balance_cents,
                availableCents: a.available_cents,
              },
            ],
      );
    },
    transactions: () => list("/transactions", NessieTransactionSchema, 5000),
    bills: () => list("/bills", NessieBillSchema, 100),
    close() {
      // Stop sibling reads too when one member of a snapshot request fails.
      controller.abort(cancelled());
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCancel);
    },
  };
}
