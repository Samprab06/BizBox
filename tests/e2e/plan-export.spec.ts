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

  test("print styles keep the plan visible and hide the persistent consultant", async ({
    page,
  }) => {
    await mockPlan(page);
    await page.goto(`/projects/${PROJECT}/plan?comparison=${comparisonId}`);
    await expect(
      page.getByRole("button", { name: "Print or save as PDF" }),
    ).toBeVisible();
    const assistant = page.getByRole("complementary", {
      name: "Assistant",
      exact: true,
      includeHidden: true,
    });
    await expect(assistant).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("button", { name: "Print or save as PDF" }),
    ).toBeHidden();
    await expect(assistant).toBeHidden();
    await expect(
      page.getByRole("article", { name: "Location plan" }),
    ).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Expand the assistant" }).click();
    await expect(
      page.getByRole("article", { name: "Location plan", includeHidden: true }),
    ).toBeHidden();
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByRole("article", { name: "Location plan" }),
    ).toBeVisible();
    await expect(assistant).toBeHidden();
  });
  test("printed plan is dark text on white paper and stays dark on screen", async ({
    page,
  }) => {
    await mockPlan(page);
    await page.goto(`/projects/${PROJECT}/plan?comparison=${comparisonId}`);
    const article = page.getByRole("article", { name: "Location plan" });
    await expect(article).toBeVisible();

    // Resolves any CSS color to opaque sRGB channels through a canvas pixel.
    const colors = () =>
      page.evaluate(() => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        const rgb = (value: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        };
        const sample = (selector: string) => {
          const el = document.querySelector(selector) as HTMLElement;
          return rgb(getComputedStyle(el).color);
        };
        return {
          body: rgb(getComputedStyle(document.body).backgroundColor),
          heading: sample("article h2"),
          muted: sample("article dt"),
          cell: sample("article tbody td"),
        };
      });
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    const screen = await colors();
    expect(luminance(screen.body)).toBeLessThan(0.1);
    expect(contrast(screen.heading, screen.body)).toBeGreaterThanOrEqual(4.5);

    await page.emulateMedia({ media: "print" });
    const print = await colors();
    expect(print.body).toEqual([255, 255, 255]);
    for (const text of [print.heading, print.muted, print.cell])
      expect(contrast(text, print.body)).toBeGreaterThanOrEqual(7);
  });
});
