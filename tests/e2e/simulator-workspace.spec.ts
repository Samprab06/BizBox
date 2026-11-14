import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  await expect(
    page
      .getByRole("navigation", { name: "Project views" })
      .getByRole("link", { name: "Simulator", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const context = page.getByRole("complementary", {
    name: "Project context",
    exact: true,
  });
  await expect(
    context.getByText("Example", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Modeled monthly contribution change", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Time basis and included costs", { exact: true })
    .click();
  await expect(
    page
      .getByText(
        /22 weekdays · ingredients, labor, rent, buildout amortization/,
      )
      .first(),
  ).toBeVisible();
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
      page.getByRole("heading", { name: "Baseline", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  const expand = page.getByRole("button", {
    name: "Expand Baseline modeled café",
    exact: true,
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  if (browserName === "chromium") {
    await expect(
      page.getByRole("button", {
        name: "Collapse Baseline modeled café",
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
