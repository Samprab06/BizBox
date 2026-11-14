import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  liveCandidateIds,
  liveComparisonId,
  liveComparisonPayload,
  liveComparisonRecord,
  mockLiveComparison,
} from "./live-comparison-fixtures";

const replayUrl = (day = "weekday", site = liveCandidateIds[0]) =>
  `/projects/houston-coffee/replay?site=${encodeURIComponent(site)}&comparison=${liveComparisonId}&day=${day}`;

test.describe("stored representative replay", () => {
  test("plays canonical weekday events and switches to the stored weekend run", async ({
    page,
  }) => {
    await mockLiveComparison(page);
    await page.goto(replayUrl());
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Replay", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
    const weekday = liveComparisonPayload.result.sites.find(
      (site) => site.siteId === liveCandidateIds[0],
    )!.representative.weekday;
    await expect(
      page.getByText(new RegExp(`seed ${weekday.seed}`)),
    ).toBeVisible();
    const seek = page.getByRole("slider", { name: "Seek to simulated time" });
    await seek.focus();
    await seek.press("End");
    const run = liveComparisonRecord.runs.find(
      (entry) => entry.id === weekday.runId,
    )!;
    await expect(page.locator('[aria-label="Replay counts"]')).toContainText(
      `${run.metrics.completedCustomers} served`,
    );
    await page.getByLabel("Inspect a customer").selectOption({ index: 1 });
    await expect(
      page.getByRole("region", { name: "Stored customer events" }),
    ).toBeVisible();
    await expect(page.getByText("Stay probability at arrival")).toBeVisible();
    await expect(
      page.getByText(
        "No Jev panel answers were used for this persona in this run.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("link", { name: /^weekend$/i }).click();
    await expect(page).toHaveURL(/day=weekend/);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Stored representative simulation · weekend/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^weekend$/i }),
    ).toHaveAttribute("aria-current", "page");
    await page
      .getByText("Representative hourly statistics", { exact: true })
      .click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/One seeded weekend scenario/)).toBeVisible();
  });

  test("keeps a labelled playable example when the stored run fails, then retries", async ({
    page,
  }) => {
    await mockLiveComparison(page);
    let failed = true;
    await page.route("**/api/site-runs/*?*", (route) => {
      if (failed)
        return route.fulfill({
          status: 503,
          json: { code: "RUN_UNAVAILABLE" },
        });
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/").pop()!,
      );
      return route.fulfill({
        json: { run: liveComparisonRecord.runs.find((run) => run.id === id) },
      });
    });
    await page.goto(replayUrl());
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The stored run is unavailable" }),
    ).toHaveText(
      "The stored run is unavailable. Showing an example replay below.",
    );
    await expect(
      page
        .getByRole("region", { name: "Replay", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Retry stored run" }).click();
    await expect(
      page
        .getByRole("region", { name: "Replay", exact: true })
        .getByText("Example data", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
  });

  test("does not play a response from another project", async ({ page }) => {
    await mockLiveComparison(page);
    await page.route("**/api/site-runs/*?*", (route) =>
      route.fulfill({
        json: {
          run: {
            ...liveComparisonRecord.runs[0],
            projectId: "another-project",
          },
        },
      }),
    );
    await page.goto(replayUrl());
    await expect(
      page.getByRole("button", { name: "Retry stored run" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Replay", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
  });

  test("shows progress while the canonical run is loading", async ({
    page,
  }) => {
    await mockLiveComparison(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/site-runs/*?*", async (route) => {
      await gate;
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/").pop()!,
      );
      await route.fulfill({
        json: { run: liveComparisonRecord.runs.find((run) => run.id === id) },
      });
    });
    await page.goto(replayUrl());
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Loading stored representative run" }),
    ).toBeVisible();
    release();
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
  });

  test("keeps fixture replay without completed intake", async ({ page }) => {
    await page.goto("/projects/houston-coffee/replay?site=montrose");
    await expect(
      page
        .getByRole("region", { name: "Replay", exact: true })
        .getByText("Example data", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
  });

  test("retains keyboard controls, reduced motion and responsive accessible playback", async ({
    page,
  }) => {
    await mockLiveComparison(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(replayUrl());
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    for (const width of [390, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
    }
    const seek = page.getByRole("slider", { name: "Seek to simulated time" });
    await seek.focus();
    await expect(seek).toBeFocused();
    await expectNoA11yViolations(page);
  });
});
