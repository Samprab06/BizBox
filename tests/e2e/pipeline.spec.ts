import { test, expect } from "./fixtures";
import { BusinessProfileSchema } from "../../lib/contracts";
import { SiteSearchResultSchema } from "../../lib/contracts/sites";
import { CatchmentResponseSchema } from "../../lib/contracts/catchment";
import { syntheticHoustonFixture } from "../../fixtures/houston-coffee";
import {
  comparableResult,
  comparisonResponse,
  enterPipelineIntake,
  pipelineCandidateIds,
  pipelineProject,
  recordedEvaluation,
  runComparison,
  storedRuns,
} from "./pipeline-fixtures";

// Writes snapshots/comparisons. Explicit local opt-in, never silently touches a hosted DB.
test.describe("real HTTP pipeline (dedicated local seeded PostGIS)", () => {
  test.skip(
    process.env.E2E_PIPELINE_DB !== "1",
    "Seed a dedicated local database; set E2E_PIPELINE_DB=1 (README).",
  );
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browserName, request }, info) => {
    expect(
      info.config.workers,
      `Pipeline ${browserName} shares houston-coffee snapshots across browser projects; run with --workers=1.`,
    ).toBe(1);
    const health = await request.get("/api/health", { timeout: 10_000 });
    expect(
      health.status(),
      "The dedicated seeded local PostGIS app must be healthy before pipeline tests run.",
    ).toBe(200);
  });
  test.beforeEach(async ({ baseURL }) => {
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
      new URL(baseURL!).hostname,
    );
  });

  test("coffee intake → top three search/catchments → comparison origins → changed founder assumption", async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await enterPipelineIntake(page);
    // Only external map decoration is replaced; app API requests all reach the server.
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [] },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    const searched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/sites" &&
        response.request().method() === "POST",
    );
    await page.getByRole("link", { name: "Map", exact: true }).click();
    const search = SiteSearchResultSchema.parse(await (await searched).json());
    const ids = search.candidates.slice(0, 3).map((row) => row.candidate.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids)).toEqual(new Set(pipelineCandidateIds));
    const list = page.getByRole("list", { name: "Candidate sites" });
    await expect(list.getByRole("link")).toHaveCount(3);
    for (const candidate of await list.getByRole("link").all()) {
      await candidate.click();
      const metrics = page
        .getByRole("region", { name: "Candidate locations", exact: true })
        .getByRole("definition");
      await expect(metrics).toHaveCount(3);
      for (const metric of await metrics.all())
        await expect(metric).toContainText(/costar|public|founder|default/);
    }

    for (const row of search.candidates) {
      for (const metric of [
        row.baseRentCents,
        row.opexCents,
        row.totalMonthlyCostCents,
        row.candidate.floorAreaSqFt,
      ]) {
        expect(metric.origin).toMatch(/^(costar|public|founder|default)$/);
        expect(metric.evidenceIds.length).toBeGreaterThan(0);
      }
      const response = await page.request.get(
        `/api/sites/${encodeURIComponent(row.candidate.id)}/catchment?projectId=${pipelineProject}&category=coffee&radiusMeters=1000`,
      );
      expect(response.status()).toBe(200);
      const catchment = CatchmentResponseSchema.parse(await response.json());
      expect(catchment.residents.population.origin).toBe("default");
      expect(catchment.residents.blockGroups[0].population.origin).toBe(
        "public",
      );
      expect(catchment.workers.jobs.origin).toBe("public");
      await page.goto(
        `/projects/${pipelineProject}/sites/${encodeURIComponent(row.candidate.id)}`,
      );
      const definitions = page
        .getByRole("region", { name: "Site detail", exact: true })
        .getByRole("definition");
      await expect(
        definitions.filter({ hasText: /costar/ }).first(),
      ).toBeVisible();
      for (const definition of await definitions.all()) {
        if (/\d/.test(await definition.innerText()))
          await expect(definition).toContainText(
            /costar|public|founder|default/,
          );
      }
    }
    await page.goto(`/projects/${pipelineProject}/comparison`);
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/comparisons" &&
        response.request().method() === "POST",
    );
    const started = performance.now();
    await page
      .getByRole("button", { name: "Run comparison", exact: true })
      .click();
    const created = comparisonResponse.parse(
      await (await createdResponse).json(),
    );
    const elapsedMs = Math.round(performance.now() - started);
    await info.attach("pipeline-timing-browser-assembly", {
      body: JSON.stringify({
        elapsedMs,
        budgetMs: 60000,
        environment: "local HTTP, synthetic sources",
      }),
      contentType: "application/json",
    });
    expect(elapsedMs).toBeLessThan(60_000);
    expect(new Set(created.result.ranking)).toEqual(new Set(ids));
    expect(created.assembly!.assumptions["profile.servers"].origin).toBe(
      "founder",
    );
    expect(
      created.assembly!.assumptions["profile.buildoutBudgetCents"].origin,
    ).toBe("founder");
    // Intake collects a tier, not a dollar ticket or stations: those defaults must stay honest.
    expect(
      created.assembly!.assumptions["profile.averageTicketCents"].origin,
    ).toBe("default");
    const evidence = page.getByRole("complementary", {
      name: "Comparison assumptions and findings",
    });
    await expect(evidence).toContainText("profile.buildoutBudgetCents");
    await expect(evidence).toContainText("founder");
    await expect(
      page.getByRole("table", { name: /Live comparison/ }),
    ).toContainText("90% interval");
    await page.goto(`/projects/${pipelineProject}/intake?mode=form`);
    await page.getByLabel("Buildout budget ($)", { exact: true }).fill("72000");
    await page.getByRole("link", { name: "Comparison", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /comparison is outdated/ }),
    ).toBeVisible();
    const rerunResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/comparisons" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Rerun comparison", exact: true })
      .click();
    const changed = comparisonResponse.parse(
      await (await rerunResponse).json(),
    );
    expect(changed.result.profileVersion).toBeGreaterThan(
      created.result.profileVersion,
    );
    expect(
      changed.result.sites.map(
        (site) => site.monthlyContributionAfterBuildoutUsd,
      ),
    ).not.toEqual(
      created.result.sites.map(
        (site) => site.monthlyContributionAfterBuildoutUsd,
      ),
    );
    const old = await page.request.get(
      `/api/comparisons/${created.comparisonId}?projectId=${pipelineProject}`,
    );
    expect(comparisonResponse.parse(await old.json()).outdated).toBe(true);
  });

  test("recorded panel → demand → simulation persists exact repeat, altered seeds and explicit Huff fallback", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    const profile = structuredClone(syntheticHoustonFixture.profile);
    profile.projectId = pipelineProject;
    const saved = await request.post("/api/profiles", {
      data: { projectId: pipelineProject, profile },
    });
    expect(saved.status()).toBe(201);
    const snapshot = BusinessProfileSchema.parse((await saved.json()).profile);
    const input = await recordedEvaluation(snapshot, pipelineCandidateIds);
    const first = await runComparison(request, input, info, "recorded");
    expect(first.result.demandSource).toBe("jev");
    const again = await runComparison(
      request,
      { projectId: pipelineProject, rerunComparisonId: first.comparisonId },
      info,
      "repeat",
    );
    expect(comparableResult(again.result)).toEqual(
      comparableResult(first.result),
    );
    expect(await storedRuns(request, again.result)).toEqual(
      await storedRuns(request, first.result),
    );
    const altered = await runComparison(
      request,
      { ...input, baseSeed: 12 },
      info,
      "altered-seed",
    );
    expect(altered.result.seeds).not.toEqual(first.result.seeds);
    const arrivals = (await storedRuns(request, altered.result)).map(
      (run) => run.arrivals,
    );
    expect(arrivals).not.toEqual(
      (await storedRuns(request, first.result)).map((run) => run.arrivals),
    );
    for (const site of altered.result.sites) {
      const baseline = first.result.sites.find(
        (row) => row.siteId === site.siteId,
      )!;
      // The public interval is monthly served customers; no arrival interval is exposed.
      expect(site.monthlyServedCustomers.mean).toBeGreaterThanOrEqual(
        baseline.monthlyServedCustomers.low,
      );
      expect(site.monthlyServedCustomers.mean).toBeLessThanOrEqual(
        baseline.monthlyServedCustomers.high,
      );
    }
    const fallback = await runComparison(
      request,
      {
        ...input,
        sites: input.sites.map((original) => {
          const site = { ...original };
          delete site.behaviorTable;
          delete site.behaviorTableId;
          return site;
        }),
      },
      info,
      "missing-table",
    );
    expect(fallback.result.requestedDemandSource).toBe("jev");
    expect(fallback.result.demandSource).toBe("huff");
    expect(fallback.result.fallbackReason).toBeTruthy();
    await enterPipelineIntake(page);
    await page.goto(
      `/projects/${pipelineProject}/comparison?comparison=${fallback.comparisonId}`,
    );
    await expect(page.getByText(/Demand source: Huff/i)).toBeVisible();
    await expect(page.getByText(/Fallback reason:/)).toContainText(
      fallback.result.fallbackReason!,
    );
  });
});
