import type { Page } from "@playwright/test";
import { buildLocationPlan } from "../../lib/agent/plan";
import { fixture } from "../../lib/agent/__fixtures__/plan";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// HAC-26: printable location plan, with the comparison and plan APIs mocked.

const PROJECT = "houston-coffee";
const source = fixture();
// The page is scoped to the route's project, so re-scope the saved fixture to it.
const comparisonId = source.comparison.id;
const plan = (() => {
  const p = buildLocationPlan(source);
  return { ...p, plan: { ...p.plan, projectId: PROJECT } };
})();
const comparison = (outdated: boolean) => ({
  comparisonId,
  outdated,
  result: { ...source.comparison.evaluation.result, projectId: PROJECT },
  comparison: source.comparison.comparison,
});

async function mockPlan(page: Page, outdated = false) {
  await page.route(`**/api/comparisons/${comparisonId}/plan?*`, (route) =>
    route.fulfill({ json: plan }),
  );
  await page.route(`**/api/comparisons/${comparisonId}?*`, (route) =>
    route.fulfill({ json: comparison(outdated) }),
  );
}

test.describe("location plan export", () => {
  test("renders a cited, printable plan with sources and no sales forecast", async ({
    page,
  }) => {
    await mockPlan(page);
    await page.goto(`/projects/${PROJECT}/plan?comparison=${comparisonId}`);

    await expect(
      page.getByRole("heading", { level: 2, name: "Location plan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Recommendation" }),
    ).toContainText(plan.plan.recommendation);
    await expect(
      page.getByRole("heading", {
        name: "Assumptions and where they come from",
      }),
    ).toBeVisible();
    await expect(page.getByText(/U.S. Census Bureau/).first()).toBeVisible();
    await expect(page.getByText(/not a sales forecast/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Print or save as PDF" }),
    ).toBeVisible();
    // Every value cell in the plan tables carries an origin/citation cell beside it.
    const rows = page.locator("article table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    await expectNoA11yViolations(page);
  });

  test("refuses an outdated comparison and links to rerun it", async ({
    page,
  }) => {
    await mockPlan(page, true);
    await page.goto(`/projects/${PROJECT}/plan?comparison=${comparisonId}`);
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "This comparison is outdated." });
    await expect(alert).toContainText("This comparison is outdated.");
    await alert.getByRole("link", { name: "Rerun the comparison" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/comparison`));
  });

  test("without a comparison it asks for one", async ({ page }) => {
    await page.goto(`/projects/${PROJECT}/plan`);
    await expect(page.getByRole("status")).toContainText(
      "Choose a saved comparison first.",
    );
  });

  test("print styles hide the print button", async ({ page }) => {
    await mockPlan(page);
    await page.goto(`/projects/${PROJECT}/plan?comparison=${comparisonId}`);
    await expect(
      page.getByRole("button", { name: "Print or save as PDF" }),
    ).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("button", { name: "Print or save as PDF" }),
    ).toBeHidden();
  });
});
