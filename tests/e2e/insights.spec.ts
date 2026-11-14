import { test, expect, expectNoA11yViolations } from "./fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  liveCandidateIds,
} from "./live-comparison-fixtures";
import { mockLiveSites } from "./live-site-fixtures";

const path = "/projects/houston-coffee/sites/";
const livePath =
  path +
  encodeURIComponent(liveCandidateIds[0]) +
  "?comparison=" +
  liveComparisonId;

for (const width of [375, 768, 1280]) {
  test(`Insights retain readable charts, tables and day controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path + "montrose");
    const panel = page.getByRole("region", { name: "Insights", exact: true });
    await expect(panel).toContainText("Authored synthetic service example");
    await expect(
      panel.locator(".recharts-wrapper > svg.recharts-surface"),
    ).toHaveCount(6);
    await expect(
      panel.getByRole("img", { name: /Modeled served-origin hex map/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await panel.getByRole("button", { name: "Weekend", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Weekend", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.locator('[aria-label="Weekend insights"]'),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Cumulative revenue", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Cumulative revenue", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const summary = panel.getByText("View demand vs capacity data", {
      exact: true,
    });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("region", { name: "Demand vs capacity data table" }),
    ).toBeVisible();
    await expect(
      panel
        .getByRole("region", { name: "Demand vs capacity data table" })
        .getByRole("row"),
    ).toHaveCount(25);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await expectNoA11yViolations(page);
  });
}

test("stored Insights use actual retained aggregates and preserve stale scenario identity", async ({
  page,
}) => {
  await mockLiveSites(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && !request.url().endsWith("/api/sites"))
      posts.push(request.url());
  });
  await page.route("**/api/comparisons/*?*", (route) =>
    route.fulfill({ json: { ...liveComparisonPayload, outdated: true } }),
  );
  await page.goto(livePath);
  const panel = page.getByRole("region", { name: "Insights", exact: true });
  await expect(panel).toContainText("profile profile-live-57 v1");
  await expect(
    page.getByText("Saved scenario is outdated.", { exact: false }),
  ).toBeVisible();
  await expect(panel).toContainText("3 seeds per day");
  const day = liveComparisonPayload.result.sites[0].insights!.days.weekday;
  const peak = day.hours
    .filter((row) => !row.closed)
    .reduce((a, b) => (b.arrivals.mean > a.arrivals.mean ? b : a));
  await expect(
    panel.locator('ul[aria-label="Modeled day highlights"] data').first(),
  ).toHaveAttribute("value", String(peak.arrivals.mean));
  await expect(
    panel.getByText("Sampled origins", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Review comparisons", exact: true }),
  ).toHaveAttribute("href", new RegExp("comparison=" + liveComparisonId));
  expect(posts).toEqual([]);
});

test("legacy runs remain unavailable and failed reads can retry without model writes", async ({
  page,
}) => {
  await mockLiveSites(page);
  let recovered = false;
  const legacy = structuredClone(liveComparisonPayload);
  legacy.result.sites.forEach((site) => {
    delete site.insights;
  });
  await page.route("**/api/comparisons/*?*", (route) => {
    return !recovered
      ? route.fulfill({ status: 503, json: { error: "offline" } })
      : route.fulfill({ json: legacy });
  });
  await page.goto(livePath);
  await expect(
    page.getByRole("button", { name: "Retry insights" }),
  ).toBeVisible();
  recovered = true;
  await page.getByRole("button", { name: "Retry insights" }).click();
  await expect(
    page.getByText(
      "This saved comparison has no retained cross-seed insights.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.locator(".recharts-wrapper > svg.recharts-surface"),
  ).toHaveCount(0);
});

test("a direct comparison link works without intake and rejects a different stored profile", async ({
  page,
}) => {
  await page.route("**/api/comparisons/*?*", (route) =>
    route.fulfill({ json: liveComparisonPayload }),
  );
  await page.goto(livePath);
  await expect(
    page.getByRole("region", { name: "Insights", exact: true }),
  ).toContainText("3 seeds per day");
  await page.evaluate(
    ({ id }) =>
      localStorage.setItem(
        "sitework:comparison:v1:houston-coffee",
        JSON.stringify({
          projectId: "houston-coffee",
          comparisonId: id,
          profileId: "wrong-profile",
          profileVersion: 1,
        }),
      ),
    { id: liveComparisonId },
  );
  await page.reload();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Saved insights could not be verified" }),
  ).toBeVisible();
  await expect(
    page.locator(".recharts-wrapper > svg.recharts-surface"),
  ).toHaveCount(0);
});

test("actual chart SVG colors and keyboard tooltips stay legible on both surfaces", async ({
  page,
}) => {
  await page.goto(path + "montrose");
  const panel = page.getByRole("region", { name: "Insights", exact: true });
  await expect(
    panel.locator(".recharts-wrapper > svg.recharts-surface"),
  ).toHaveCount(6);
  for (const surface of ["paper", "viewport"]) {
    await panel.evaluate(
      (element, value) => element.setAttribute("data-surface", value),
      surface,
    );
    const result = await panel.evaluate((element) => {
      const lum = (rgb: string) => {
        const channels = (rgb.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            const n = c / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const ratio = (a: string, b: string) => {
        const aa = lum(a),
          bb = lum(b);
        return (Math.max(aa, bb) + 0.05) / (Math.min(aa, bb) + 0.05);
      };
      const ticks = [
        ...element.querySelectorAll<SVGElement>(
          ".recharts-cartesian-axis-tick-value",
        ),
      ];
      const tickContrast = ticks.map((tick) =>
        ratio(
          getComputedStyle(tick).fill,
          getComputedStyle(tick.closest(".sw-card")!).backgroundColor,
        ),
      );
      const lines = [
        ...element.querySelectorAll<SVGElement>(".recharts-line-curve"),
      ];
      return {
        count: ticks.length,
        minTick: Math.min(...tickContrast),
        lineContrast: lines.map((line) =>
          ratio(
            getComputedStyle(line).stroke,
            getComputedStyle(line.closest(".sw-card")!).backgroundColor,
          ),
        ),
      };
    });
    expect(result.count).toBeGreaterThan(20);
    expect(result.minTick).toBeGreaterThanOrEqual(4.5);
    expect(Math.min(...result.lineContrast)).toBeGreaterThanOrEqual(3);
    const chart = panel
      .locator(".recharts-wrapper > svg.recharts-surface")
      .first();
    await chart.focus();
    await expect(chart).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      panel.locator(".recharts-tooltip-wrapper").first(),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  }
});
