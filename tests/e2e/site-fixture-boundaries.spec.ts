import { expect, test } from "./fixtures";
import { mockLiveSites } from "./live-site-fixtures";

const fixtureSites = [
  ["montrose", "Montrose storefront"],
  ["heights", "Heights storefront"],
] as const;

for (const savedIntake of [false, true]) {
  for (const [siteId, address] of fixtureSites) {
    test(`${siteId} keeps fixture evidence local ${savedIntake ? "with" : "without"} a saved intake`, async ({
      page,
    }) => {
      if (savedIntake) await mockLiveSites(page);
      const liveRequests: string[] = [];
      await page.route("**/api/sites/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (
          /\/api\/sites\/[^/]+\/(?:catchment|interior(?:\/floorplan)?|scene)$/.test(
            path,
          )
        ) {
          liveRequests.push(path);
          return route.fulfill({
            status: 400,
            json: { error: "Invalid site identifier" },
          });
        }
        return route.fallback();
      });
      await page.goto(`/projects/houston-coffee/sites/${siteId}`);
      const detail = page.getByRole("region", {
        name: "Site detail",
        exact: true,
      });
      await expect(
        detail.getByRole("heading", { name: address, exact: true }),
      ).toBeVisible();
      await expect(
        detail.getByText("These are example listing details.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        detail.getByText("Synthetic listing fixture", { exact: false }),
      ).toBeVisible();
      await expect(
        detail.getByText("Synthetic resident and worker estimates", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(
        detail.getByLabel("Illustrative floor plan", { exact: true }),
      ).toBeVisible();
      await detail
        .getByRole("button", { name: "Weekend", exact: true })
        .click();
      await expect(
        detail.getByRole("button", { name: "Weekend", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await detail
        .getByText("Example data", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      expect(liveRequests).toEqual([]);
      await expect(detail.getByRole("alert")).toHaveCount(0);
    });
  }
}

test("real catchment failures stay visible and Retry requests the same real identity", async ({
  page,
}) => {
  await mockLiveSites(page);
  const requests: string[] = [];
  await page.route("**/api/sites/*/catchment?*", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.goto("/projects/houston-coffee/sites/201%3A301");
  const detail = page.getByRole("region", { name: "Site detail", exact: true });
  await expect(
    detail.getByRole("heading", { name: "101 Invented St" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("alert").filter({ hasText: /Catchment unavailable/ }),
  ).toBeVisible();
  await expect(
    detail.getByRole("definition").filter({ hasText: "12,400" }),
  ).not.toBeVisible();
  const beforeRetry = requests.length;
  await page.getByRole("button", { name: "Retry catchment" }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(beforeRetry);
  expect([...new Set(requests)]).toEqual(["/api/sites/201%3A301/catchment"]);
  await expect(
    detail.getByRole("alert").filter({ hasText: /Catchment unavailable/ }),
  ).toBeVisible();
});
