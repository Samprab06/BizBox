import { expect, test } from "./fixtures";

// HAC-176: labels on the example comparison. No live Jev or model calls.
test.describe("example comparison labels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/projects/houston-coffee/comparison");
  });

  test("hourly chart says it is one representative run per site", async ({
    page,
  }) => {
    const figure = page.locator("figure", {
      has: page.locator("#wait-overlay-title"),
    });
    await expect(figure).toContainText(/One representative weekday run/);
    await expect(figure).toContainText(/seed \d+/);
    await expect(figure.locator("caption")).toContainText(
      /One representative weekday run/,
    );
  });

  test("contribution column header states period and unit", async ({
    page,
  }) => {
    const table = page.getByRole("table", { name: /^Comparison/ });
    await expect(
      table.getByRole("columnheader", {
        name: /Mean monthly contribution \(USD/,
      }),
    ).toBeVisible();
  });

  test("table is reachable at 1024 px: scroll region or no overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    const region = page.getByRole("region", {
      name: "Comparison table, scrollable",
    });
    await expect(region).toBeVisible();
    const clipped = await region.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    if (clipped) {
      await expect(
        page.getByText("Scroll sideways to see every column"),
      ).toBeVisible();
      await region.focus();
      await expect(region).toBeFocused();
    }
    for (const width of [390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow, `page overflow at ${width}px`).toBe(false);
    }
  });

  test("sensitivity lists all three scenarios and marks the current one", async ({
    page,
  }) => {
    const list = page
      .getByRole("heading", { name: "Visit-frequency sensitivity" })
      .locator("xpath=following-sibling::ul");
    await expect(list.locator("li")).toHaveCount(3);
    const current = list.locator("li[aria-current='true']");
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("100% of baseline");
    await expect(current).toContainText("Current");
    await page.goto("/projects/houston-coffee/comparison?visits=1.2");
    await expect(
      page
        .getByRole("heading", { name: "Visit-frequency sensitivity" })
        .locator("xpath=following-sibling::ul")
        .locator("li[aria-current='true']"),
    ).toContainText("120% of baseline");
  });
});
