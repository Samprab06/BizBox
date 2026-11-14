import { buildLocationPlan } from "../../lib/agent/plan";
import { fixture as planFixture } from "../../lib/agent/__fixtures__/plan";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { completeIntake, liveSearch, liveSiteId } from "./live-site-fixtures";
import {
  comparisonForCandidates,
  liveComparisonId,
  liveComparisonPayload,
  liveComparisonRecord,
  mockLiveComparison,
} from "./live-comparison-fixtures";

const contextBar = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Project context", exact: true });
const actualSearch = () => {
  const data = structuredClone(liveSearch);
  data.candidates.forEach((entry) => {
    entry.candidate.synthetic = false;
  });
  return data;
};
const actualComparison = () => {
  const data = structuredClone(liveComparisonPayload);
  data.comparison.synthetic = false;
  return data;
};

test("context persists across all existing workspace routes and labels fixture selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const route of [
    "intake?site=heights",
    "map?site=heights",
    "sites/heights",
    "comparison?site=heights",
    "replay?site=heights",
  ]) {
    await page.goto(`/projects/houston-coffee/${route}`);
    const bar = contextBar(page);
    await expect(
      bar.getByRole("link", { name: "View data and evidence: Example data" }),
    ).toBeVisible();
    await expect(
      bar.getByRole("link", {
        name: "Change selected location: Heights storefront",
      }),
    ).toBeVisible();
    await expect(
      bar.getByText("Example", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      bar.getByRole("link", { name: "View baseline scenario: Baseline" }),
    ).toHaveAttribute("href", /\/comparison\?site=heights/);
  }
});

test("incomplete and complete founder intake do not silently select a fixture", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/houston-coffee/intake");
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", {
      name: "Change selected location: Choose a location",
    }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Business concept", { exact: true })
    .fill("Founder café");
  await expect(
    bar.getByRole("link", { name: "Change business concept: Founder café" }),
  ).toBeVisible();
  await completeIntake(page);
  await page.reload();
  await expect(
    bar.getByRole("link", {
      name: "Change business concept: Neighborhood coffee",
    }),
  ).toBeVisible();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Your input" }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
});

test("verified live listings show suite/address without extra search requests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeIntake(page);
  let searches = 0;
  await page.route("**/api/sites", (route) => {
    searches++;
    return route.fulfill({ json: actualSearch() });
  });
  await page.goto(`/projects/houston-coffee/map?site=${liveSiteId}`);
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", {
      name: /Change selected location:.*101 Invented St/,
    }),
  ).toBeVisible();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Live listings" }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
  expect(searches).toBe(1);
  await bar.getByRole("link", { name: /Change selected location:/ }).click();
  await expect(page).toHaveURL(/\/map\?site=201%3A301$/);
});

test("synthetic API listings retain Example and a retry can transition to live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeIntake(page);
  let synthetic = true;
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: synthetic ? liveSearch : actualSearch() }),
  );
  await page.goto(`/projects/houston-coffee/map?site=${liveSiteId}`);
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Example data" }),
  ).toBeVisible();
  synthetic = false;
  await page.getByRole("button", { name: "Retry search", exact: true }).click();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Live listings" }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
});

test("new comparison adoption updates context and preserves the actual comparison link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLiveComparison(page);
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: actualSearch() }),
  );
  await page.route("**/api/comparisons", (route) => {
    const payload = comparisonForCandidates(
      route.request().postDataJSON().candidateIds,
    );
    payload.comparison.synthetic = false;
    return route.fulfill({ status: 201, json: payload });
  });
  await page.goto("/projects/houston-coffee/comparison");
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Ready to compare" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Live comparison" }),
  ).toBeVisible();
  await expect(
    bar.getByRole("link", { name: "View baseline scenario: Baseline" }),
  ).toHaveAttribute("href", new RegExp(`comparison=${liveComparisonId}`));
  await expect(
    bar.getByText("Modeled, not a forecast", { exact: true }).first(),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
});

test("comparison source metadata controls Example versus unknown provenance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLiveComparison(page);
  await page.goto(
    `/projects/houston-coffee/comparison?comparison=${liveComparisonId}`,
  );
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Example data" }),
  ).toBeVisible();
  const unknown = { ...liveComparisonPayload, comparison: undefined };
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (route) =>
    route.fulfill({ json: unknown }),
  );
  await page.reload();
  await expect(
    bar.getByRole("link", {
      name: "View data and evidence: Comparison provenance unavailable",
    }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
});

test("failed replay loads are Example even while the stored comparison remains live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockLiveComparison(page);
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (route) =>
    route.fulfill({ json: actualComparison() }),
  );
  let failed = true;
  await page.route("**/api/site-runs/*?*", (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop()!,
    );
    const run = liveComparisonRecord.runs.find((entry) => entry.id === id);
    return route.fulfill(
      failed || !run
        ? { status: 503, json: { code: "UNAVAILABLE" } }
        : { json: { run: { ...run, synthetic: false } } },
    );
  });
  await page.goto(
    `/projects/houston-coffee/replay?site=${liveSiteId}&comparison=${liveComparisonId}`,
  );
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Example data" }),
  ).toBeVisible();
  await expect(
    bar.getByRole("link", {
      name: "Change selected location: Montrose storefront",
    }),
  ).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Retry stored run" }).click();
  await expect(
    bar.getByRole("link", {
      name: "View data and evidence: Stored simulation",
    }),
  ).toBeVisible();
  await expect(
    bar.getByRole("link", { name: /Site 201:301 · address unavailable/ }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
});

test("mobile context is one line with keyboard disclosure and no axe violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/projects/houston-coffee/intake?site=montrose");
  const bar = contextBar(page);
  const summary = bar.locator("summary");
  await expect(summary).toBeVisible();
  await expect(
    bar.getByRole("link", { name: /Change business concept:/ }),
  ).toBeHidden();
  const height = await summary.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(height).toBeLessThanOrEqual(28);
  await summary.focus();
  await summary.press("Enter");
  await expect(
    bar.getByRole("link", { name: /Change business concept:/ }),
  ).toBeVisible();
  await summary.press("Space");
  await expect(
    bar.getByRole("link", { name: /Change business concept:/ }),
  ).toBeHidden();
  await summary.click();
  await expect(
    bar.getByRole("link", { name: /Change selected location:/ }),
  ).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include('aside[aria-label="Project context"]')
    .analyze();
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});

test("late search results cannot overwrite a new fixture route or another project", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await completeIntake(page);
  let start!: () => void;
  let release!: () => void;
  let finish!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/sites", async (route) => {
    start();
    await gate;
    try {
      await route.fulfill({ json: actualSearch() });
    } finally {
      finish();
    }
  });
  await page.goto(`/projects/houston-coffee/map?site=${liveSiteId}`);
  await started;
  await page
    .getByRole("navigation", { name: "Project views" })
    .getByRole("link", { name: "Site detail", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sites\/201%3A301$/);
  // Wait for the client navigation to commit before opening a fixture route.
  await page.goto("/projects/houston-coffee/sites/montrose");
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Example data" }),
  ).toBeVisible();
  release();
  await finished;
  await expect(
    bar.getByRole("link", {
      name: "Change selected location: Montrose storefront",
    }),
  ).toBeVisible();
  await expect(bar.getByRole("link", { name: /Live listings/ })).toHaveCount(0);
  await page.goto("/projects/another-project/intake");
  await expect(contextBar(page)).toHaveCount(0);
});

test("plan context labels its saved source and is excluded from print", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const source = planFixture();
  const id = source.comparison.id;
  const built = buildLocationPlan(source);
  const plan = {
    ...built,
    plan: { ...built.plan, projectId: "houston-coffee" },
  };
  let synthetic: boolean | undefined = true;
  let outdated = false;
  let failed = false;
  await page.route(`**/api/comparisons/${id}/plan?*`, (route) =>
    route.fulfill({ json: plan }),
  );
  await page.route(`**/api/comparisons/${id}?*`, (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: {} }
        : {
            json: {
              comparisonId: id,
              outdated,
              result: {
                ...source.comparison.evaluation.result,
                projectId: "houston-coffee",
              },
              comparison:
                synthetic === undefined
                  ? undefined
                  : { ...source.comparison.comparison, synthetic },
            },
          },
    ),
  );
  await page.goto(`/projects/houston-coffee/plan?comparison=${id}`);
  const bar = contextBar(page);
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Example data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print or save as PDF" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(bar).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  synthetic = false;
  await page.reload();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Stored plan" }),
  ).toBeVisible();
  await expect(bar.getByText("Example", { exact: true })).toHaveCount(0);
  synthetic = undefined;
  await page.reload();
  await expect(
    bar.getByRole("link", {
      name: "View data and evidence: Plan provenance unavailable",
    }),
  ).toBeVisible();
  synthetic = false;
  outdated = true;
  await page.reload();
  await expect(
    bar.getByRole("link", {
      name: "View data and evidence: Outdated comparison",
    }),
  ).toBeVisible();
  failed = true;
  await page.reload();
  await expect(
    bar.getByRole("link", { name: "View data and evidence: Plan unavailable" }),
  ).toBeVisible();
  await page.goto("/projects/houston-coffee/plan");
  await expect(
    bar.getByRole("link", {
      name: "View data and evidence: Choose a comparison",
    }),
  ).toBeVisible();
});
