/** Explicit, grant-accounted developer evaluation. Never invoked by app startup. */
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";
import {
  createSpatialDraft,
  applySpatialCommand,
  runSpatialExperiment,
} from "../lib/spatial";
import { FURNITURE_CATALOG } from "../lib/furniture/catalog";
import { prepareInteriorPolicies } from "../lib/interior/policies";
import { createJevClient, DEFAULT_JEV_BASE_URL } from "../lib/panel/jev-client";
import {
  createLocalInteriorPolicyStore,
  DEFAULT_INTERIOR_LEDGER,
} from "./interior-policy-local-store";
import { isMain } from "./env-policy";
export async function runInteriorPolicyCheck(args = process.argv.slice(2)) {
  const local = createLocalInteriorPolicyStore();
  if (args.includes("--initialize-original-grant")) {
    const initialized = await local.initialize();
    console.log(
      JSON.stringify({
        initialized: true,
        ledger: DEFAULT_INTERIOR_LEDGER,
        reservedMicrousd: initialized.reservedMicrousd,
      }),
    );
    return;
  }
  if (args.includes("--seal-for-db")) {
    console.log(
      JSON.stringify({
        handoff: await local.seal(),
        next: "Use this exact latest reservation and receipt for separately approved DB grant initialization. CLI is permanently sealed.",
      }),
    );
    return;
  }
  if (!args.includes("--live")) {
    console.log(
      JSON.stringify({
        live: false,
        ledger: DEFAULT_INTERIOR_LEDGER,
        requires:
          "Manager confirmation before initialize/live. Existing original grant historical reservation is 26864 microUSD. No fresh per-process allowance.",
      }),
    );
    return;
  }
  const envPath =
    args.find((_, index) => args[index - 1] === "--env") ?? ".env.local";
  const env = { ...parse(await readFile(envPath, "utf8")), ...process.env };
  if (!env.JEV_API_KEY) throw new Error("Jev key unavailable");
  const city = args.includes("--la") ? "los_angeles" : "houston";
  const initial = createSpatialDraft({
    projectId: "jev-interior-live-check",
    siteId: "synthetic-cafe",
    city,
    category: "coffee",
  });
  const baseline = applySpatialCommand(initial, {
    type: "settings",
    settings: { ...initial.settings, staff: 1, resourceCapacity: 1 },
  });
  const staffed = applySpatialCommand(baseline, {
    type: "settings",
    settings: { ...baseline.settings, staff: 2, resourceCapacity: 2 },
  });
  const variant = applySpatialCommand(staffed, {
    type: "add",
    id: "proposed-chair",
    catalogId: FURNITURE_CATALOG.find((item) => item.role === "seating")!.id,
    x: 5,
    z: 4,
    rotation: 0,
  });
  let inputTokens = 0,
    outputTokens = 0;
  const client = createJevClient({
    baseUrl: DEFAULT_JEV_BASE_URL,
    apiKey: env.JEV_API_KEY,
    modelVersion: "jev-latest",
    maxRetries: 0,
    maxRateLimitRetries: 0,
    concurrency: 1,
    timeoutMs: 6000,
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error" });
      if (response.ok) {
        const value = await response.clone().json();
        inputTokens += Number(value.usage?.input_tokens ?? 0);
        outputTokens += Number(value.usage?.output_tokens ?? 0);
      }
      return response;
    },
  });
  const prepared = await prepareInteriorPolicies(
    {
      projectId: baseline.projectId,
      comparisonId: "synthetic-developer-check",
      baseline,
      variant,
    },
    {
      grantId: "bizbox-interior-2026-11-15",
      client,
      store: local.store,
      assertScope: async (projectId, comparisonId, draft) => {
        if (
          projectId !== "jev-interior-live-check" ||
          comparisonId !== "synthetic-developer-check" ||
          draft.siteId !== "synthetic-cafe"
        )
          throw new Error(
            "Live tooling accepts only authored public synthetic cases",
          );
      },
    },
  );
  const result = runSpatialExperiment({
      baseline,
      variant,
      policies: prepared.policies,
    }),
    ledger = await local.inspect();
  const evidence = `/tmp/bizbox-interior-jev-evidence-${city}-${Date.now()}.json`;
  await writeFile(
    evidence,
    JSON.stringify(
      {
        prepared,
        baseline,
        variant,
        result,
        usage: { inputTokens, outputTokens },
        aggregateReservedMicrousd: ledger.reservedMicrousd,
        experiment:
          "Combined second staffed counter and seating/layout proposal; individual causes are not isolated",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      source: result.source,
      city,
      requests: prepared.usage.requests,
      cacheHits: prepared.usage.cacheHits,
      reservedThisCheckMicrousd: prepared.usage.reservedMicrousd,
      aggregateReservedMicrousd: ledger.reservedMicrousd,
      inputTokens,
      outputTokens,
      evidence,
      pricingSource:
        "https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost",
    }),
  );
}
if (isMain(import.meta.url))
  runInteriorPolicyCheck().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Interior policy check failed",
    );
    process.exitCode = 1;
  });
