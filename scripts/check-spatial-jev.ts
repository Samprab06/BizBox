// Explicit developer-only live evaluation; no calls on app startup or tests. Synthetic public inputs only.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  createSpatialDraft,
  applySpatialCommand,
  getSpatialPolicyStates,
  runSpatialExperiment,
} from "../lib/spatial/index";
import { FURNITURE_CATALOG } from "../lib/furniture/catalog";
async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "No provider call. Run with --live after setting JEV_API_KEY. Maximum 6 requests, conservative reservation below $1.",
    );
    return;
  }
  config({ path: ".env.local", quiet: true });
  const env = process.env;
  if (!env.JEV_API_KEY) throw Error("Jev key unavailable");
  const city = process.argv.includes("--la") ? "los_angeles" : "houston";
  const category = process.argv.includes("--salon")
    ? "salon_barber"
    : process.argv.includes("--fitness")
      ? "fitness"
      : process.argv.includes("--food")
        ? "quick_food"
        : "coffee";
  const baseline = createSpatialDraft({
    projectId: "public-synthetic-test",
    siteId: "synthetic-room",
    city,
    category,
  });
  const variant = applySpatialCommand(baseline, {
    type: "add",
    catalogId: FURNITURE_CATALOG.find((x) => x.role === "seating")!.id,
    id: "chair",
    x: 2,
    z: 3,
    rotation: 0,
  });
  let requests = 0,
    inputTokens = 0,
    reservedUsd = 0;
  const recordings: unknown[] = [];
  async function policy(draft: typeof baseline) {
    const states = [];
    let modelVersion = "";
    for (const state of getSpatialPolicyStates(draft)) {
      const questions = Object.fromEntries(
        [0, 4, 10].map((n) => [
          `stay_${n}`,
          {
            type: "noul",
            instructions: `Would this person join and remain for service with ${n} people waiting? Consider the person's needs and observed walk, seats, service time and price. Answer probability yes.`,
          },
        ]),
      );
      const body = JSON.stringify({
        model: "jev-latest",
        state: {
          person: state.description,
          need: "Decide whether to wait for the offered business service.",
          options: { shop: JSON.stringify(state) },
        },
        questions,
      });
      // Conservative bound: 1 token/UTF-8 byte, duplicated state up to question count + envelope;
      // reserve $1/M tokens, over 23x verified official $0.042/M input; no output fee.
      if (Buffer.byteLength(body) > 4096 || requests >= 6)
        throw Error("Bounded request envelope exceeded");
      const reservation = (Buffer.byteLength(body) * 4) / 1e6;
      if (reservedUsd + reservation > 1) throw Error("Budget cap");
      reservedUsd += reservation;
      requests++;
      const r = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.JEV_API_KEY}`,
        },
        body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!r.ok) throw Error(`Jev returned ${r.status}; no retries`);
      const raw = await r.json();
      if (typeof raw.model !== "string") throw Error("Missing model version");
      modelVersion = raw.model;
      const stayByQueue = [0, 4, 10].map((n) => {
        const a = raw.answers?.[`stay_${n}`];
        if (
          a?.type !== "noul" ||
          !Number.isFinite(a.noul) ||
          a.noul < 0 ||
          a.noul > 1
        )
          throw Error("Invalid probability");
        return { lineLength: n, p: a.noul };
      });
      inputTokens += raw.usage?.input_tokens ?? 0;
      states.push({ ...state, stayByQueue });
      recordings.push({ state, response: raw });
    }
    return {
      source: "jev" as const,
      modelVersion,
      evidenceId: "local-live-check",
      states,
    };
  }
  const a = await policy(baseline),
    b = await policy(variant);
  const result = runSpatialExperiment({
    baseline,
    variant,
    seeds: [11, 29, 47],
    policies: { baseline: a, variant: b },
  });
  const summary = {
    requests,
    inputTokens,
    reservedUpperBoundUsd: reservedUsd,
    reportedTokenCostUsd: (inputTokens * 0.042) / 1e6,
    pricingSource:
      "https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost",
    baselineProbabilities: a.states.map((x) => x.stayByQueue),
    variantProbabilities: b.states.map((x) => x.stayByQueue),
    source: result.source,
    servedChange: result.delta.served,
    modelVersion: a.modelVersion,
    recordingSha256: createHash("sha256")
      .update(JSON.stringify(recordings))
      .digest("hex"),
  };
  writeFileSync(
    resolve(process.env.TMPDIR ?? "/tmp", "bizbox-spatial-jev-recording.json"),
    JSON.stringify({
      summary,
      baseline,
      variant,
      policies: { baseline: a, variant: b },
      recordings,
      result,
    }),
  );
  console.log(JSON.stringify(summary));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Live check failed");
  process.exitCode = 1;
});
