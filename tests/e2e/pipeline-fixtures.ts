import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { expect } from "./fixtures";
import {
  BusinessProfileSchema,
  SiteComparisonSchema,
  SiteRunSchema,
} from "../../lib/contracts";
import {
  EvaluationRequestSchema,
  EvaluationResultSchema,
  type EvaluationResult,
} from "../../lib/contracts/evaluation";
import { z } from "zod";
import { FIXTURE_PERSONA_SET, makeStore } from "../../lib/demand/fixtures";

import catchmentJson from "../../lib/panel/__fixtures__/catchment-houston-montrose.json" with { type: "json" };
import recording from "../../lib/panel/__fixtures__/jev-recorded.json" with { type: "json" };
import { CatchmentInputSchema } from "../../lib/panel/contracts";
import { createJevClient } from "../../lib/panel/jev-client";
import { MemoryJevCache } from "../../lib/panel/cache";
import { runPanel } from "../../lib/panel/panel";

export const pipelineProject = "houston-coffee";
export const pipelineCandidateIds = ["3401:1", "3402:1", "3403:1"];
export const comparisonResponse = z.object({
  comparisonId: z.string(),
  outdated: z.boolean(),
  result: EvaluationResultSchema,
  comparison: SiteComparisonSchema,
  assembly: z
    .object({
      assumptions: z.record(
        z.string(),
        z.object({
          value: z.number(),
          origin: z.enum(["costar", "public", "founder", "default"]),
          evidenceIds: z.array(z.string()).min(1),
        }),
      ),
    })
    .optional(),
});

/** No API mocking: every answer goes through the real browser form. */
export async function enterPipelineIntake(page: Page) {
  await page.goto(`/projects/${pipelineProject}/intake?mode=form`);
  for (const text of [
    "Neighborhood coffee",
    "Any",
    "5000",
    "60000",
    "Midrange",
    "Neighbors",
    "7am-7pm",
    "2",
    "None",
  ]) {
    const answer = page.getByRole("textbox", { name: /^Your answer/ });
    await answer.fill(text);
    await answer.press("Enter");
  }
  await expect(page.getByText("All required fields are filled.")).toBeVisible();
}

/** Recorded wire responses pass through the real panel aggregator; expected outputs are never calculated in the test. */
export async function recordedEvaluation(
  profile: z.infer<typeof BusinessProfileSchema>,
  candidateIds: string[],
) {
  const hours = { openMin: 420, closeMin: 1140 };
  const catchment = CatchmentInputSchema.parse(catchmentJson);
  let wireCalls = 0;
  const offlineFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify(
        recording.variants[wireCalls++ % recording.variants.length],
      ),
      { status: 200 },
    );
  const panel = await runPanel({
    personaSet: FIXTURE_PERSONA_SET,
    site: catchment.site,
    competitors: catchment.competitors,
    need: { businessType: "coffee", priceUsd: 6, serviceMinPerCustomer: 2 },
    client: createJevClient({
      baseUrl: "https://jev.test",
      apiKey: "offline-fixture",
      fetch: offlineFetch,
    }),
    cache: new MemoryJevCache(),
  });
  expect(panel.table.failedPersonaIds).toEqual([]);
  expect(panel.table.personas).toHaveLength(
    FIXTURE_PERSONA_SET.personas.length,
  );
  expect(wireCalls).toBeGreaterThan(0);

  return EvaluationRequestSchema.parse({
    projectId: pipelineProject,
    profileId: profile.id,
    profileVersion: profile.version,
    synthetic: true,
    city: "houston",
    category: "coffee",
    priceTier: "mid",
    personaSet: FIXTURE_PERSONA_SET,
    demandSource: "jev",
    seeds: 30,
    baseSeed: 11,
    sites: candidateIds.map((siteId, index) => ({
      siteId,
      storefront: makeStore(siteId, index * 0.3, 0),
      behaviorTable: {
        ...panel.table,
        siteId,
        // Recording uses site_a; resolve that option to each invented canonical space.
        personas: panel.table.personas.map((persona) => ({
          ...persona,
          where: Object.fromEntries(
            Object.entries(persona.where).map(([id, value]) => [
              id === "site_a" ? siteId : id,
              value,
            ]),
          ),
        })),
      },
      behaviorTableId: `hac34-recorded-${siteId}`,
      config: {
        hours: { weekday: hours, weekend: hours },
        stations: { planned: 2, usableSf: 1250, sfPerStation: 250 },
        prices: { avgTicketUsd: 6.5 },
        staff: { headcount: 2, wageUsdPerHour: 16 },
        costs: { cogsPctOfRevenue: 0.27 },
        lease: {
          sf: 1250,
          askingRentUsdPerSfYear: 24 + index * 4,
          tripleNet: false,
          buildoutUsd: 24000,
          leaseTermMonths: 36,
        },
        calendar: { weekdayDaysPerMonth: 22, weekendDaysPerMonth: 8 },
      },
    })),
  });
}

export async function runComparison(
  request: APIRequestContext,
  data: unknown,
  info: TestInfo,
  label: string,
) {
  const started = performance.now();
  const response = await request.post("/api/comparisons", {
    data,
    timeout: 60_000,
  });
  const elapsedMs = Math.round(performance.now() - started);
  await info.attach(`pipeline-timing-${label}`, {
    body: JSON.stringify({
      label,
      elapsedMs,
      budgetMs: 60000,
      environment: "local HTTP; not Vercel acceptance",
    }),
    contentType: "application/json",
  });
  expect(response.status(), `${label} comparison HTTP status`).toBe(201);
  expect(elapsedMs, `${label}: comparison route's 60s budget`).toBeLessThan(
    60_000,
  );
  return comparisonResponse.parse(await response.json());
}

/** Strip only new storage identities; retain every interval, rank, seed and hourly count. */
export function comparableResult(result: EvaluationResult) {
  return {
    ...result,
    sites: result.sites.map((site) => ({
      ...site,
      representative: Object.fromEntries(
        Object.entries(site.representative).map(([day, run]) => [
          day,
          { ...run, runId: undefined, eventIds: undefined },
        ]),
      ),
    })),
  };
}

export async function storedRuns(
  request: APIRequestContext,
  result: EvaluationResult,
) {
  return Promise.all(
    result.sites.flatMap((site) =>
      ["weekday", "weekend"].map(async (day) => {
        const rep = site.representative[day as "weekday" | "weekend"];
        const response = await request.get(
          `/api/site-runs/${encodeURIComponent(rep.runId)}?projectId=${pipelineProject}`,
        );
        expect(response.status()).toBe(200);
        const run = SiteRunSchema.parse((await response.json()).run);
        const arrivals = run.events.filter(
          (event) => event.type === "arrived",
        ).length;
        expect(arrivals).toBe(
          rep.hourly.reduce((sum, hour) => sum + hour.arrivals, 0),
        );
        expect(arrivals).toBeGreaterThan(0);
        return {
          siteId: site.siteId,
          day,
          arrivals,
          metrics: run.metrics,
          events: run.events,
        };
      }),
    ),
  );
}
