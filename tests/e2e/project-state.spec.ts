import type { Page } from "@playwright/test";
import { buildLocationPlan } from "../../lib/agent/plan";
import { fixture } from "../../lib/agent/__fixtures__/plan";
import { expandProjectNavigation, expect, test } from "./fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  mockLiveComparison,
} from "./live-comparison-fixtures";

// HAC-135: the comparison shortlist and the saved comparison survive navigation, and the
// plan and simulator open the saved comparison from every entry point. All APIs are mocked.

const PROJECT = "houston-coffee";

/** The plan fixture, re-scoped to the project and the live comparison id the mocks return. */
const source = fixture();
const rescope = <T,>(value: T): T =>
  JSON.parse(
    JSON.stringify(value).replaceAll(source.comparison.id, liveComparisonId),
  ) as T;
const plan = (() => {
  const built = rescope(buildLocationPlan(source));
  return { ...built, plan: { ...built.plan, projectId: PROJECT } };
})();
const planComparison = rescope({
  comparisonId: source.comparison.id,
  outdated: false,
  result: { ...source.comparison.evaluation.result, projectId: PROJECT },
  comparison: source.comparison.comparison,
});

/** The plan page reads the comparison too; serve the record the plan fixture was built from. */
async function mockPlanComparison(page: Page) {
  await page.route(`**/api/comparisons/${liveComparisonId}?*`, (route) =>
    route.fulfill({ json: planComparison }),
  );
}

async function mockPlanAndImagery(page: Page) {
  await page.route(`**/api/comparisons/${liveComparisonId}/plan?*`, (route) =>
    route.fulfill({ json: plan }),
  );
  await page.route("**/api/vexcel/**", (route) =>
    route.fulfill({ status: 503, body: "Imagery unavailable in offline test" }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
}

async function saveComparison(page: Page) {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: `sitework:comparison:v1:${PROJECT}`,
      value: {
        projectId: PROJECT,
        comparisonId: liveComparisonId,
        profileId: liveComparisonPayload.result.profileId,
        profileVersion: liveComparisonPayload.result.profileVersion,
        intakeFingerprint: "",
      },
    },
  );
}

const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Project views", exact: true });
const navLink = (page: Page, name: string) =>
  nav(page).getByRole("link", { name, exact: true });

test("the shortlist and result survive navigating away and back", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await mockPlanAndImagery(page);
  await page.goto(`/projects/${PROJECT}/comparison`);
  const second = page.getByRole("checkbox", { name: /202 Invented St/ });
  await expect(second).toBeChecked();
  await second.uncheck();
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const table = page.getByRole("table", { name: /Live comparison/ });
  await expect(table).toBeVisible();

  await expandProjectNavigation(page);
  await navLink(page, "Map").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/map`));
  await expandProjectNavigation(page);
  await navLink(page, "Comparison").click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/comparison`));

  await expect(table).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /101 Invented St/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /202 Invented St/ }),
  ).not.toBeChecked();
  await expect(page.getByText(/1 selected/)).toBeVisible();
});

test("after a run, the plan and simulator links open the saved comparison", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await mockPlanAndImagery(page);
  await page.goto(`/projects/${PROJECT}/comparison`);
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("table", { name: /Live comparison/ }),
  ).toBeVisible();

  await expandProjectNavigation(page);
  const comparison = new RegExp(`comparison=${liveComparisonId}`);
  await expect(navLink(page, "Simulator")).toHaveAttribute("href", comparison);
  await expect(navLink(page, "Location plan")).toHaveAttribute(
    "href",
    comparison,
  );

  await mockPlanComparison(page);
  await navLink(page, "Location plan").click();
  await expect(page).toHaveURL(comparison);
  await expect(
    page.getByRole("region", { name: "Recommendation" }),
  ).toContainText(plan.plan.recommendation);
  await expect(page.getByText("Choose a saved comparison first.")).toHaveCount(
    0,
  );

  await expandProjectNavigation(page);
  await expect(navLink(page, "Simulator")).toHaveAttribute("href", comparison);
  await navLink(page, "Simulator").click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${PROJECT}/simulator\\?comparison=${liveComparisonId}`),
  );
});

test("a bare plan URL opens the saved comparison", async ({ page }) => {
  await mockLiveComparison(page);
  await mockPlanAndImagery(page);
  await saveComparison(page);
  await mockPlanComparison(page);
  await page.goto(`/projects/${PROJECT}/plan`);
  await expect(
    page.getByRole("region", { name: "Recommendation" }),
  ).toContainText(plan.plan.recommendation);
  await expect(page.getByText("Choose a saved comparison first.")).toHaveCount(
    0,
  );
});

test("a bare simulator URL loads the saved comparison", async ({ page }) => {
  await mockPlanAndImagery(page);
  await saveComparison(page);
  await page.goto(`/projects/${PROJECT}/simulator`);
  await expect(page).toHaveURL(
    new RegExp(`/projects/${PROJECT}/simulator\\?comparison=${liveComparisonId}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Simulator", exact: true }),
  ).toBeVisible();
});

test("without a saved comparison the plan still asks for one and the simulator stays on the example", async ({
  page,
}) => {
  await mockPlanAndImagery(page);
  await page.goto(`/projects/${PROJECT}/plan`);
  await expect(page.getByRole("status").first()).toContainText(
    "Choose a saved comparison first.",
  );
  await expandProjectNavigation(page);
  await expect(navLink(page, "Simulator")).toHaveAttribute(
    "href",
    /\/simulator\?site=montrose$/,
  );
  await page.goto(`/projects/${PROJECT}/simulator`);
  await expect(
    page.getByRole("heading", { name: "Simulator", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});
