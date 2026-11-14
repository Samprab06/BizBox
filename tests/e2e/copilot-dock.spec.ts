import { expect, expectNoA11yViolations, test, PROJECT_ID } from "./fixtures";

/**
 * HAC-84: the copilot dock lives in the project layout. Until HAC-83's runtime adapter is
 * wired, it says so instead of showing scripted activity; the scenario list comes from
 * the existing scenario route, stubbed here so the spec needs no database.
 */
const tree = {
  tree: [
    {
      scenario: {
        id: "base",
        parentId: null,
        label: "Baseline",
        author: "founder",
        createdAt: "2026-11-14T10:00:00.000Z",
      },
      children: ["early"],
    },
    {
      scenario: {
        id: "early",
        parentId: "base",
        label: "Open at 6am",
        author: "agent",
        createdAt: "2026-11-14T11:00:00.000Z",
      },
      children: [],
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/projects/${PROJECT_ID}/scenarios`, (route) =>
    route.fulfill({ json: tree }),
  );
});

test("the dock opens, keeps its state across navigation and passes axe", async ({
  page,
  gotoView,
}) => {
  await gotoView("map");
  const dock = page.getByRole("complementary", { name: /^Copilot/ });
  const toggle = dock.getByRole("button", { name: "Show copilot" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(
    dock.getByRole("button", { name: "Hide copilot" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    dock.getByText(/copilot runtime isn't connected yet/),
  ).toBeVisible();

  const scenario = dock.getByLabel(/Active scenario/);
  await scenario.selectOption("early");
  await expectNoA11yViolations(page);

  // Client navigation keeps the layout, and with it the dock, mounted.
  await page
    .getByRole("navigation", { name: "Project views" })
    .getByRole("link", { name: "Comparison", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/comparison/);
  await expect(
    dock.getByRole("button", { name: "Hide copilot" }),
  ).toBeVisible();
  await expect(dock.getByLabel(/Active scenario/)).toHaveValue("early");

  // A reload in the same tab restores it from session storage.
  await page.reload();
  await expect(dock.getByLabel(/Active scenario/)).toHaveValue("early");
});

test("an unavailable scenario service shows a useful, retryable state", async ({
  page,
  gotoView,
}) => {
  await page.route(`**/api/projects/${PROJECT_ID}/scenarios`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "SCENARIO_UNAVAILABLE",
        message: "Scenario service is temporarily unavailable.",
        field_errors: {},
      },
    }),
  );
  await gotoView("map");
  const dock = page.getByRole("complementary", { name: /^Copilot/ });
  await dock.getByRole("button", { name: "Show copilot" }).click();
  await expect(
    dock.getByText("Scenario service is temporarily unavailable."),
  ).toBeVisible();
  await expect(dock.getByRole("button", { name: "Retry" })).toBeVisible();
});
