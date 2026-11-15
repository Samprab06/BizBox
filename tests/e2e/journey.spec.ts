import { execFileSync } from "node:child_process";
import type { Page, Response, TestInfo } from "@playwright/test";
import { buildLocationPlan } from "../../lib/agent/plan";
import { fixture as planFixture } from "../../lib/agent/__fixtures__/plan";
import { evaluateSites } from "../../lib/evaluation/evaluate";
import { buildStoredComparison } from "../../lib/evaluation/store";
import { expect, test } from "./fixtures";
import {
  comparisonForCandidates,
  liveComparisonPayload,
  liveComparisonRecord,
  liveComparisonSearch,
} from "./live-comparison-fixtures";
import { liveCatchment } from "./live-site-fixtures";

// HAC-39: the whole founder journey in one test, timed step by step against the demo budget.
//
//   E2E_BASE_URL=<prod url> pnpm test:e2e --grep @journey     live: real APIs, model and Jev
//   pnpm test:e2e --grep @journey                              local: every API is mocked
//
// A remote E2E_BASE_URL runs live; the local server (or a loopback E2E_BASE_URL) runs with
// the synthetic mocks from the shared fixtures, so a local run makes no database, model or
// paid calls. E2E_JOURNEY_LIVE=1 or =0 overrides the choice. Every assertion reads its
// expected values from the responses the app itself received, so one code path covers both.

/** HAC-39 demo time budget for the whole journey (default from the ticket: 4 minutes). */
const JOURNEY_BUDGET_MS = 4 * 60_000;

const PROJECT = "houston-coffee";
const COMPARISON_KEY = `sitework:comparison:v1:${PROJECT}`;

function isLive() {
  const flag = process.env.E2E_JOURNEY_LIVE;
  if (flag === "1" || flag === "0") return flag === "1";
  const base = process.env.E2E_BASE_URL;
  if (!base) return false;
  const host = new URL(base).hostname;
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}
const LIVE = isLive();

/** What the founder types into the intake form (the same values as `completeIntake`). */
const INTAKE: [label: string, value: string][] = [
  ["Business concept", "Neighborhood coffee"],
  ["Areas to favor or avoid", "Any"],
  ["Monthly rent ceiling ($)", "5000"],
  ["Buildout budget ($)", "60000"],
  ["Price tier", "Midrange"],
  ["Target customers", "Neighbors"],
  ["Opening hours", "7am-7pm"],
  ["Staff on shift", "2"],
  ["Must-haves", "None"],
];
/**
 * The changed assumption. Staff is not a search filter, so the same candidates come back
 * live, but it changes the economics the comparison evaluates.
 */
const CHANGED = { label: "Staff on shift", from: "2", to: "3" } as const;

type Comparison = typeof liveComparisonPayload;
type Search = typeof liveComparisonSearch;

// ---------------------------------------------------------------------------------------
// Local mocks. The first comparison is the shared synthetic one; the rerun is an invented
// re-evaluation with three staff and a higher asking rent at the first site, so the ranking
// visibly changes. Both are seeded evaluations from lib/, not hand-written numbers.

const RERUN_ID = "comparison-synthetic-57-rerun";
const rerunRecord = (() => {
  const request = structuredClone(liveComparisonRecord.evaluation.request);
  request.profileVersion = 2;
  for (const site of request.sites) site.config.staff.headcount = 3;
  request.sites[0]!.config.lease.askingRentUsdPerSfYear = 40;
  return buildStoredComparison(RERUN_ID, request, evaluateSites(request));
})();
const rerunPayload: Comparison = {
  ...structuredClone(liveComparisonPayload),
  comparisonId: RERUN_ID,
  result: rerunRecord.evaluation.result,
  comparison: rerunRecord.comparison,
};

function planFor(record: typeof liveComparisonRecord) {
  const source = planFixture();
  source.projectId = PROJECT;
  source.profile.projectId = PROJECT;
  source.profile.id = record.evaluation.result.profileId;
  source.profile.version = record.evaluation.result.profileVersion;
  source.comparison = structuredClone(record);
  return buildLocationPlan(source);
}

const INVESTIGATION_ID = "inv-journey";
function investigationState(
  profileId: string,
  status: "queued" | "running" | "succeeded",
  tools: string[],
) {
  return {
    job: {
      id: INVESTIGATION_ID,
      projectId: PROJECT,
      profileId,
      question: "Where should this coffee shop open?",
      status,
      attempt: 1,
      findings:
        status === "succeeded" ? ["Demographics are partly default."] : [],
      reason: null,
    },
    milestones: tools.map((tool, seq) => ({
      investigationId: INVESTIGATION_ID,
      attempt: 1,
      seq,
      tool,
      inputHash: `h${seq}`,
      summary: {},
      createdAt: "2026-11-14T12:00:00.000Z",
    })),
  };
}

async function installMocks(page: Page) {
  const comparisons = new Map<string, Comparison>();
  const records = [liveComparisonRecord, rerunRecord];
  const profilePosts: {
    profile: { capacity: { servers: { value: number } } };
  }[] = [];
  let profileVersion = 0;

  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        version: 8,
        name: "e2e-stub",
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e8efe9" },
          },
        ],
      }),
    }),
  );
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { modelConfigured: false } })
      : route.fallback(),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: liveComparisonSearch }),
  );
  await page.route("**/api/sites/*/catchment?*", (route) =>
    route.fulfill({ json: liveCatchment }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: false } }),
  );
  await page.route("**/api/profiles", (route) => {
    const body = route.request().postDataJSON();
    profilePosts.push(body);
    profileVersion += 1;
    return route.fulfill({
      status: 201,
      json: {
        profile: {
          ...body.profile,
          id: liveComparisonPayload.result.profileId,
          version: profileVersion,
        },
        persisted: true,
      },
    });
  });
  await page.route("**/api/comparisons", (route) => {
    const ids = route.request().postDataJSON().candidateIds as string[];
    // First run: the synthetic comparison; every later run: the rerun.
    const base =
      comparisons.size === 0 ? comparisonForCandidates(ids) : rerunPayload;
    comparisons.set(base.comparisonId, base);
    return route.fulfill({ status: 201, json: base });
  });
  await page.route("**/api/comparisons/*?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop()!,
    );
    const payload = comparisons.get(id);
    return route.fulfill(
      payload
        ? { json: { ...payload, outdated: false } }
        : { status: 404, json: { code: "COMPARISON_NOT_FOUND" } },
    );
  });
  await page.route("**/api/comparisons/*/plan?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-2)!,
    );
    const record = records.find((entry) => entry.id === id);
    return route.fulfill(
      record
        ? { json: planFor(record) }
        : { status: 404, json: { code: "COMPARISON_NOT_FOUND" } },
    );
  });
  await page.route("**/api/site-runs/*?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop()!,
    );
    const run = records
      .flatMap((record) => record.runs)
      .find((entry) => entry.id === id);
    return route.fulfill(
      run
        ? { json: { run } }
        : { status: 404, json: { code: "RUN_NOT_FOUND" } },
    );
  });

  // The consultant job: created by POST, then advanced by the panel to a finished state.
  const tools = [
    "save_profile",
    "search_sites",
    "get_catchment",
    "evaluate_sites",
    "finish_investigation",
  ];
  let profileId = "";
  let step = 0;
  const states = () => [
    investigationState(profileId, "queued", []),
    investigationState(profileId, "running", tools.slice(0, 2)),
    investigationState(profileId, "running", tools.slice(0, 4)),
    investigationState(profileId, "succeeded", tools),
  ];
  await page.route("**/api/investigations", (route) => {
    profileId = route.request().postDataJSON().profileId;
    step = 0;
    return route.fulfill({ status: 201, json: states()[0] });
  });
  await page.route(
    `**/api/investigations/${INVESTIGATION_ID}/advance`,
    (route) => {
      step = Math.min(step + 1, states().length - 1);
      return route.fulfill({ json: states()[step] });
    },
  );
  await page.route(`**/api/investigations/${INVESTIGATION_ID}`, (route) =>
    route.fulfill({ json: states()[step] }),
  );
  return { profilePosts };
}

// ---------------------------------------------------------------------------------------
// Timing: every step is a `test.step`, and each one's wall time goes into the report.

type Timing = { step: string; ms: number };
function stepTimer(testInfo: TestInfo) {
  const timings: Timing[] = [];
  const started = Date.now();
  const run = async <T>(name: string, body: () => Promise<T>) =>
    test.step(name, async () => {
      const t0 = Date.now();
      try {
        return await body();
      } finally {
        const ms = Date.now() - t0;
        timings.push({ step: name, ms });
        testInfo.annotations.push({
          type: "step time",
          description: `${name}: ${(ms / 1000).toFixed(1)}s`,
        });
      }
    });
  const elapsed = () => Date.now() - started;
  const remaining = () => Math.max(5_000, JOURNEY_BUDGET_MS - elapsed());
  return { run, timings, elapsed, remaining };
}

const isApi = (path: string, method: string) => (response: Response) =>
  response.request().method() === method &&
  new URL(response.url()).pathname === path;

const comparisonTable = (page: Page, id: string) =>
  page.getByRole("table", {
    name: `Live comparison ${id} · monthly contribution in USD`,
    exact: true,
  });

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const profileField = (page: Page, label: string) =>
  page.getByLabel(new RegExp(`^${escapeRegExp(label)}`));

/** The comparison table lists the payload's ranking, in order, by address. */
async function expectRankingShown(
  page: Page,
  payload: Comparison,
  search: Search,
) {
  const headers = await comparisonTable(page, payload.comparisonId)
    .getByRole("rowheader")
    .allTextContents();
  expect(headers).toHaveLength(payload.result.ranking.length);
  payload.result.ranking.forEach((id, index) => {
    const { address } = search.candidates.find(
      (c) => c.candidate.id === id,
    )!.candidate;
    expect(headers[index], `rank ${index + 1}`).toContain(
      `${index + 1}. ${address}`,
    );
  });
}

test.describe("founder journey @journey", () => {
  test.describe.configure({ mode: "serial" });

  test("intake → map → site → comparison → investigation → rerun → replay → plan export, within the demo budget", async ({
    page,
  }, testInfo) => {
    // Live runs cost model and Jev calls: run them once, in the desktop Chromium project.
    test.skip(
      LIVE && testInfo.project.name !== "chromium",
      "live journey runs once, in chromium",
    );
    test.skip(
      testInfo.project.name === "mobile-chrome",
      "the demo journey is a desktop presentation",
    );
    test.setTimeout(JOURNEY_BUDGET_MS + 60_000);
    testInfo.annotations.push({
      type: "mode",
      description: LIVE ? "live" : "mocked",
    });

    const mocks = LIVE ? null : await installMocks(page);
    const step = stepTimer(testInfo);
    let search!: Search;
    let first!: Comparison;
    let rerun!: Comparison;
    let profileId = "";

    await step.run(
      "1. intake: a fresh project's founder fills the profile",
      async () => {
        await page.goto(`/projects/${PROJECT}/intake?mode=form`);
        // A fresh project: no saved intake or comparison in this browser.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await expect(
          page.getByRole("heading", { level: 2, name: "Business profile" }),
        ).toBeVisible();
        await expect(profileField(page, "Business concept")).toHaveValue("");
        for (const [label, value] of INTAKE) {
          const field = profileField(page, label);
          if ((await field.evaluate((el) => el.tagName)) === "SELECT")
            await field.selectOption(value);
          else await field.fill(value);
          await field.blur();
          await expect(field).toHaveValue(value);
        }
        await expect(
          page.getByText(/^Form fields are filled\./),
        ).toBeVisible();
      },
    );

    await step.run("2. map: candidate sites load from the intake", async () => {
      const searched = page.waitForResponse(isApi("/api/sites", "POST"), {
        timeout: 60_000,
      });
      await page.goto(`/projects/${PROJECT}/map`);
      search = (await (await searched).json()) as Search;
      expect(
        search.candidates.length,
        "live search returned candidates",
      ).toBeGreaterThan(0);
      const rows = page
        .getByRole("list", { name: "Candidate sites" })
        .getByRole("link");
      await expect(rows).toHaveCount(search.candidates.length);
      const address = search.candidates[0]!.candidate.address;
      await rows.filter({ hasText: address }).click();
      await expect(page).toHaveURL(
        new RegExp(
          `site=${encodeURIComponent(search.candidates[0]!.candidate.id)}`,
        ),
      );
    });

    await step.run(
      "3. site detail: the selected site opens with its evidence",
      async () => {
        const { address } = search.candidates[0]!.candidate;
        await page
          .getByRole("link", { name: `View details for ${address}` })
          .click();
        await expect(page).toHaveURL(/\/sites\//);
        await expect(
          page.getByRole("heading", { name: address }),
        ).toBeVisible();
        await expect(
          page
            .getByRole("region", { name: "Site detail", exact: true })
            .getByText("Example data", { exact: true }),
        ).toHaveCount(0);
      },
    );

    await step.run("4. comparison: run the shortlist and rank it", async () => {
      await page.goto(`/projects/${PROJECT}/comparison`);
      const run = page.getByRole("button", {
        name: "Run comparison",
        exact: true,
      });
      await expect(run).toBeEnabled({ timeout: 60_000 });
      const profiled = page.waitForResponse(isApi("/api/profiles", "POST"));
      const compared = page.waitForResponse(isApi("/api/comparisons", "POST"), {
        timeout: 120_000,
      });
      await run.click();
      profileId = (
        (await (await profiled).json()) as { profile: { id: string } }
      ).profile.id;
      first = (await (await compared).json()) as Comparison;
      await expect(comparisonTable(page, first.comparisonId)).toBeVisible();
      await expectRankingShown(page, first, search);
    });

    await step.run(
      "5. consultant: a live investigation runs to done",
      async () => {
        // Started from the page, as the founder's session would, so local route mocks apply.
        const created = await page.evaluate(
          async (body) => {
            const response = await fetch("/api/investigations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.text() };
          },
          {
            projectId: PROJECT,
            profileId,
            question:
              "Where should this coffee shop open? Compare my shortlist.",
          },
        );
        expect(created.status, created.body).toBe(201);
        const { job } = JSON.parse(created.body) as { job: { id: string } };
        await page.goto(
          `/projects/${PROJECT}/comparison?comparison=${encodeURIComponent(first.comparisonId)}&investigation=${encodeURIComponent(job.id)}`,
        );
        const panel = page.getByRole("region", { name: "Consultant activity" });
        await expect(panel.getByRole("status")).toHaveText("Done", {
          timeout: step.remaining(),
        });
        await expect(
          panel
            .getByRole("list", { name: "Investigation steps" })
            .getByRole("listitem")
            .last(),
        ).toHaveText("Finished the investigation");
        await expect(comparisonTable(page, first.comparisonId)).toBeVisible();
      },
    );

    await step.run(
      "6. assumption change: the saved comparison becomes outdated",
      async () => {
        await page.goto(`/projects/${PROJECT}/intake?mode=form`);
        const field = profileField(page, CHANGED.label);
        await expect(field).toHaveValue(CHANGED.from);
        await field.fill(CHANGED.to);
        await field.blur();
        await expect(field).toHaveValue(CHANGED.to);
        await page.goto(`/projects/${PROJECT}/comparison`);
        await expect(comparisonTable(page, first.comparisonId)).toBeVisible();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "This comparison is outdated." }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: "Export the location plan",
            exact: true,
          }),
        ).toHaveCount(0);
      },
    );

    await step.run(
      "7. rerun: the comparison reruns with the change and the ranking updates",
      async () => {
        const profiled = page.waitForResponse(isApi("/api/profiles", "POST"));
        const compared = page.waitForResponse(
          isApi("/api/comparisons", "POST"),
          { timeout: 120_000 },
        );
        await page
          .getByRole("button", { name: "Rerun comparison", exact: true })
          .click();
        const savedProfile = (await (await profiled).json()) as {
          profile: {
            version: number;
            capacity: { servers: { value: number } };
          };
        };
        expect(savedProfile.profile.capacity.servers.value).toBe(
          Number(CHANGED.to),
        );
        rerun = (await (await compared).json()) as Comparison;
        expect(rerun.comparisonId).not.toBe(first.comparisonId);
        expect(rerun.result.profileVersion).toBeGreaterThan(
          first.result.profileVersion,
        );
        await expect(comparisonTable(page, rerun.comparisonId)).toBeVisible();
        await expect(page).toHaveURL(
          new RegExp(`comparison=${rerun.comparisonId}`),
        );
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "This comparison is outdated." }),
        ).toHaveCount(0);
        await expectRankingShown(page, rerun, search);
        if (mocks) {
          // The invented rerun changes the leader, so the screen must not keep the old order.
          expect(rerun.result.ranking).not.toEqual(first.result.ranking);
          expect(
            mocks.profilePosts.at(-1)!.profile.capacity.servers.value,
          ).toBe(Number(CHANGED.to));
        }
      },
    );

    await step.run(
      "8. replay: the top site's representative weekday reconciles with the comparison",
      async () => {
        const top = rerun.result.sites.find(
          (site) => site.siteId === rerun.result.ranking[0],
        )!;
        const { address } = search.candidates.find(
          (c) => c.candidate.id === top.siteId,
        )!.candidate;
        const rep = top.representative.weekday;
        // The comparison's own hourly statistics add up to the run's totals.
        const sum = (key: "served" | "abandoned") =>
          rep.hourly.reduce((total, hour) => total + hour[key], 0);
        expect(sum("served"), "hourly served adds up").toBe(rep.served);
        expect(sum("abandoned"), "hourly abandoned adds up").toBe(
          rep.abandoned,
        );
        const table = comparisonTable(page, rerun.comparisonId);
        // Match the rank prefix: a modeled-tie note can name the other site's address too.
        const row = table.getByRole("row").filter({
          has: page.getByRole("rowheader").filter({
            hasText: new RegExp(`^1\\. ${escapeRegExp(address)}`),
          }),
        });
        await row.getByRole("link", { name: "Replay weekday" }).click();
        await expect(page).toHaveURL(
          new RegExp(`comparison=${rerun.comparisonId}`),
        );
        await expect(
          page.getByRole("button", { name: "Play", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          page
            .getByRole("region", { name: "Replay", exact: true })
            .getByText("Example data", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText(new RegExp(`seed ${rep.seed}\\b`)),
        ).toBeVisible();
        const seek = page.getByRole("slider", {
          name: "Seek to simulated time",
        });
        await seek.focus();
        await seek.press("End");
        // HAC-27: "metrics reconcile with events". The end-of-day counts are replayed from the
        // stored events; they must equal the representative run's totals in the comparison.
        await expect(page.getByLabel("Replay counts")).toContainText(
          `${rep.served} served`,
        );
        await expect(page.getByLabel("Replay counts")).toContainText(
          `${rep.abandoned} left`,
        );
      },
    );

    await step.run(
      "9. plan export: the plan matches the selected comparison",
      async () => {
        await page.goto(
          `/projects/${PROJECT}/comparison?comparison=${encodeURIComponent(rerun.comparisonId)}`,
        );
        await expect(comparisonTable(page, rerun.comparisonId)).toBeVisible();
        await page
          .getByRole("link", { name: "Export the location plan", exact: true })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/plan\\?comparison=${rerun.comparisonId}`),
        );
        const article = page.getByRole("article", { name: "Location plan" });
        await expect(article).toContainText(
          `Comparison ${rerun.comparisonId}`,
          { timeout: 30_000 },
        );
        const why = article.getByRole("region", {
          name: "Why this site",
          exact: true,
        });
        const exported = (await why.getByRole("rowheader").allTextContents())
          .filter((label) => label.endsWith(" monthlyContributionUsd"))
          .map((label) => label.split(" · ")[0]);
        expect(exported).toEqual(rerun.result.ranking);
        for (const id of rerun.result.ranking) {
          const metric = rerun.result.sites.find(
            (s) => s.siteId === id,
          )!.monthlyContributionUsd;
          const money = (value: number) =>
            value.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 0,
            });
          await expect(
            why
              .getByRole("row")
              .filter({
                has: page.getByRole("rowheader", {
                  name: `${id} · sites ${id} monthlyContributionUsd`,
                  exact: true,
                }),
              })
              .getByRole("cell", {
                name: `${money(metric.low)} – ${money(metric.high)} /month (range)`,
                exact: true,
              }),
          ).toBeVisible();
        }
        await expect(
          page.getByRole("button", { name: /print/i }),
        ).toBeEnabled();
      },
    );

    const total = step.elapsed();
    const report = [...step.timings, { step: "total", ms: total }];
    await testInfo.attach("journey-timings.json", {
      body: JSON.stringify(
        {
          mode: LIVE ? "live" : "mocked",
          budgetMs: JOURNEY_BUDGET_MS,
          steps: report,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(
      `[journey ${testInfo.project.name}, ${LIVE ? "live" : "mocked"}]\n` +
        report
          .map(
            ({ step: name, ms }) =>
              `  ${(ms / 1000).toFixed(1).padStart(6)}s  ${name}`,
          )
          .join("\n"),
    );
    expect(
      total,
      `journey took ${(total / 1000).toFixed(1)}s; the demo budget is ${JOURNEY_BUDGET_MS / 1000}s`,
    ).toBeLessThanOrEqual(JOURNEY_BUDGET_MS);
  });

  test("after scripts/reset-demo.ts the next journey starts clean, with data and the Jev cache kept", async ({
    page,
    request,
  }, testInfo) => {
    test.fixme(true, "HAC-27: scripts/reset-demo.ts not merged yet");
    test.skip(
      testInfo.project.name !== "chromium",
      "the reset is checked once",
    );
    // The previous test's comparison (live) or the synthetic one (local).
    const saved = await page
      .evaluate((key) => localStorage.getItem(key), COMPARISON_KEY)
      .catch(() => null);
    const previousId = saved
      ? (JSON.parse(saved) as { comparisonId: string }).comparisonId
      : liveComparisonPayload.comparisonId;

    execFileSync("pnpm", ["exec", "tsx", "scripts/reset-demo.ts"], {
      stdio: "inherit",
    });

    // The project's comparisons are gone.
    const old = await request.get(
      `/api/comparisons/${encodeURIComponent(previousId)}?projectId=${PROJECT}`,
    );
    expect(old.status()).toBe(404);
    // Loaded data stays: a search for the same intake still returns candidates.
    await page.goto(`/projects/${PROJECT}/map`);
    await expect(
      page.getByRole("list", { name: "Candidate sites" }).getByRole("link"),
    ).not.toHaveCount(0);
    // The Jev cache stays: capabilities still report Jev as configured on the deployment.
    const capabilities = await request.get("/api/comparisons/capabilities");
    expect(await capabilities.json()).toMatchObject({ jevConfigured: true });
    // A fresh browser starts clean: no saved comparison, examples until the founder runs one.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/projects/${PROJECT}/comparison`);
    await expect(
      page
        .getByRole("region", { name: "Comparison", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
  });
});
