import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closeConsultant, expandProjectNavigation, openConsultant } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/vexcel/**", (route) =>
    route.fulfill({ status: 503, body: "Imagery unavailable in offline test" }),
  );
});

// Shell/error-state checks do not depend on live imagery or hosted tile costs.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/vexcel/3d/**", (route) =>
    route.fulfill({ status: 503, body: "Imagery unavailable for this test" }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
});

test("legacy simulator links retain replay state inside the workspace", async ({
  page,
}) => {
  await page.goto(
    "/simulator-demo?comparison=missing-local-record&site=montrose&run=recorded-run",
  );
  await expect(page).toHaveURL(
    /\/projects\/houston-coffee\/simulator\?comparison=missing-local-record&site=montrose&run=recorded-run$/,
  );
  await expect(
    page.getByRole("heading", { name: "Simulator", exact: true }),
  ).toBeVisible();
  await expandProjectNavigation(page);
  await expect(
    page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("link", { name: "Simulator", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // An explicit broken permalink stays a recovery state, even with no local database.
  await expect(
    page.getByRole("heading", {
      name: /Comparison (not found|temporarily unavailable)/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Modeled monthly contribution change", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to workspace", exact: true }),
  ).toHaveAttribute("href", "/projects/houston-coffee/workspace");
  await page
    .getByRole("link", { name: "Open the example", exact: true })
    .click();
  await expect(page).toHaveURL(/simulator\?example=1$/);
  await expect(
    page.getByText("Modeled monthly contribution change", { exact: true }),
  ).toBeVisible();
});

test("live statistics use the selected scenario and shared replay clock", async ({
  page,
}) => {
  await page.goto("/projects/houston-coffee/simulator");
  const stats = page.getByRole("region", { name: "Modeled day statistics" });
  const seek = stats.getByRole("slider", { name: "Seek local time" });
  const scenario = page.getByRole("combobox", {
    name: "Decision replay scenario",
  });

  await expect(stats.getByRole("heading")).toContainText("One staffed counter");
  await seek.press("End");
  const baseline = await stats.getByRole("img").getAttribute("aria-label");
  await expect(
    page.getByRole("slider", { name: "Decision operating replay time" }),
  ).toHaveAttribute("aria-valuetext", "12:00 PM");
  await seek.press("Home");
  await expect(stats.getByRole("img")).toHaveAccessibleName(
    "0 cumulative purchases by 08:00",
  );
  await seek.press("End");
  await expect(stats.getByRole("img")).toHaveAccessibleName(baseline!);

  await scenario.selectOption("1");
  await expect(stats.getByRole("heading")).toContainText(
    "Two staffed counters",
  );
  await seek.press("End");
  await expect(stats.getByRole("img")).not.toHaveAccessibleName(baseline!);
  await expect(
    stats.getByRole("button", { name: "Area overview" }),
  ).toBeDisabled();
});

test("simulator fits phone, tablet and desktop and expands with the keyboard", async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/houston-coffee/simulator");
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "One staffed counter", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  const expand = page.getByRole("button", {
    name: "Expand One staffed counter modeled café",
    exact: true,
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  if (browserName === "chromium") {
    await expect(
      page.getByRole("button", {
        name: "Collapse One staffed counter modeled café",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(expand).toBeFocused();
  }
  const axe = await new AxeBuilder({ page })
    .include('section[aria-label="Simulator"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
});

test("unavailable WebGL keeps the neighborhood fallback and Retry inside the workspace", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_SIMULATOR_CITY !== "1",
    "Run against a local server with a dummy VEXCEL_API_KEY to exercise the city branch; imagery is intercepted offline.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(type)) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/projects/houston-coffee/simulator");
  const city = page.getByRole("region", { name: "Vexcel 3D neighborhood" });
  await city.scrollIntoViewIfNeeded();
  const fallback = page.getByText(
    /3D neighborhood unavailable\. Check WebGL support or retry imagery/,
  );
  await expect(fallback).toBeVisible();
  await expect(city.getByText("Error constructing CesiumWidget.")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(fallback).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Simulator", exact: true }),
  ).toBeAttached();
  expect(errors).toEqual([]);
});

// No database, imagery, model or provider service is needed for these recovery checks.
test("bogus comparison keeps its URL and retry path without showing seeded example values", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Offline test" } }),
  );
  await page.goto(
    "/projects/houston-coffee/simulator?comparison=does-not-exist&site=chosen-site",
  );
  await expect(
    page.getByRole("heading", {
      name: /Comparison (not found|temporarily unavailable)/,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/comparison=does-not-exist&site=chosen-site$/);
  await expect(
    page.getByText("Modeled monthly contribution change", { exact: true }),
  ).toHaveCount(0);
  const retry = page.getByRole("link", { name: "Retry", exact: true });
  if (await retry.count())
    await expect(retry).toHaveAttribute(
      "href",
      "/projects/houston-coffee/simulator?comparison=does-not-exist&site=chosen-site",
    );
});

test("invalid comparison recovery reveals a saved-focus view only once and explicit example escapes saved restoration", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Offline test" } }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "bizbox:consultant-layout:v1:houston-coffee",
      "focus",
    );
    localStorage.setItem(
      "sitework:comparison:v1:houston-coffee",
      JSON.stringify({
        projectId: "houston-coffee",
        comparisonId: "invalid-saved-id",
        profileId: "test-profile",
        profileVersion: 1,
        intakeFingerprint: "test-fingerprint",
      }),
    );
  });
  // An explicitly empty ID is deterministic not_found without any database access.
  await page.goto("/projects/houston-coffee/simulator?comparison=");
  await expect(
    page.getByRole("heading", { name: "Comparison not found", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-consultant-layout]")).toHaveAttribute(
    "data-consultant-layout",
    "docked",
  );
  // A later deliberate focus choice survives the recovery component's rerender.
  await openConsultant(page);
  await page
    .getByRole("button", { name: "Expand the assistant", exact: true })
    .click();
  await expect(page.locator("[data-consultant-layout]")).toHaveAttribute(
    "data-consultant-layout",
    "focus",
  );
  await page
    .getByRole("button", { name: "Show the current step", exact: true })
    .click();
  await closeConsultant(page);
  await page
    .getByRole("link", { name: "Open the example", exact: true })
    .click();
  await expect(page).toHaveURL(/simulator\?example=1$/);
  await expect(
    page.getByText("Modeled monthly contribution change", { exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/invalid-saved-id/);
});
