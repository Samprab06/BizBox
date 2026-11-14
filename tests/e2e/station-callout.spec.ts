import { test, expect, expectNoA11yViolations } from "./fixtures";
import { mockLiveSites } from "./live-site-fixtures";
import {
  liveComparisonId,
  liveComparisonPayload,
  liveCandidateIds,
} from "./live-comparison-fixtures";
import { STATION_EXPERIMENT_FIXTURES } from "../../lib/insights/station-experiment-fixture";
import { stationPlan } from "./station-experiment-fixtures";

const livePath = `/projects/houston-coffee/sites/${encodeURIComponent(liveCandidateIds[0])}?comparison=${liveComparisonId}`;
test.beforeEach(async ({ page }) => {
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({ json: { modelConfigured: false } }),
  );
  await page.route("**/api/comparisons/*?*", (route) =>
    route.fulfill({ json: liveComparisonPayload }),
  );
});

for (const width of [375, 768, 1280])
  test(`fixture station recommendation retains exact ranges and costs at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writes: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") writes.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/projects/houston-coffee/sites/montrose");
    const panel = page.getByRole("region", { name: "Insights", exact: true }),
      card = page.getByRole("region", {
        name: "Station recommendation",
        exact: true,
      });
    for (const day of ["weekday", "weekend"] as const) {
      await panel
        .getByRole("button", {
          name: day === "weekday" ? "Weekday" : "Weekend",
          exact: true,
        })
        .click();
      const actual = STATION_EXPERIMENT_FIXTURES.montrose[day]!;
      await expect(
        card.locator(`data[value="${actual.monthlyRevenueChangeUsd.mean}"]`),
      ).toBeVisible();
      await expect(
        card.locator(
          `data[value="${actual.monthlyContributionChangeUsd.mean}"]`,
        ),
      ).toBeVisible();
      await expect(card).toContainText("Contribution decreases");
      await expect(card).toContainText("Whole operating days");
      await expect(card).toContainText("Staff 2 → 4");
      await expect(card).toContainText("Modeled, not a forecast");
    }
    for (const surface of ["paper", "viewport"]) {
      await panel.evaluate(
        (element, value) => element.setAttribute("data-surface", value),
        surface,
      );
      await card
        .getByText("Station experiment evidence and limitations", {
          exact: true,
        })
        .focus();
      await page.keyboard.press("Enter");
      await expect(card).toContainText("not a confidence interval");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expectNoA11yViolations(page);
      await testInfo.attach(`station-${width}-${surface}`, {
        body: await card.screenshot(),
        contentType: "image/png",
      });
      await card.screenshot({
        path: `/tmp/hac102-station-${width}-${surface}-${testInfo.project.name}.png`,
      });
      await page.keyboard.press("Enter");
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

test("live station run stops for real confirmation, preserves progress and explicitly continues partial work", async ({
  page,
}) => {
  await mockLiveSites(page);
  let state = stationPlan();
  state.source.outdated = true;
  state.source.currentProfileVersion = 2;
  state.source.sourceNotice = "Uses saved Huff fallback";
  const posts: { configurationId: string; confirm: boolean }[] = [];
  await page.route("**/station-experiments?*", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/station-experiments", async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (posts.length === 1) state = stationPlan(1);
    if (posts.length === 2) {
      state = stationPlan(1);
      state.status = "needs_confirmation";
      state.confirmation = {
        configurationId: "plus-one",
        costUnits: 6,
        remainingUnits: 2,
      };
    }
    if (posts.length === 3) {
      state = stationPlan(1);
      state.configurations[1].status = "running";
    }
    if (posts.length === 4) state = stationPlan(2);
    if (posts.length === 5) state = stationPlan(3);
    await route.fulfill({ json: state });
  });
  await page.goto(livePath);
  const control = page.getByRole("region", {
    name: "Station experiment",
    exact: true,
  });
  await expect(control).toContainText("Uses saved Huff fallback");
  await expect(control).toContainText("Outdated comparison");
  await expect(
    control.getByRole("button", { name: "Run planned station configurations" }),
  ).toBeEnabled();
  expect(posts).toHaveLength(0);
  await control
    .getByRole("button", { name: "Run planned station configurations" })
    .click();
  await expect(control).toContainText("1 of 3 configurations completed");
  await expect(control).toContainText("requires 6 units; 2 units remain");
  expect(posts).toHaveLength(2);
  await control.getByRole("button", { name: "Confirm 6 budget units" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    control.getByRole("button", { name: "Continue station experiment" }),
  ).toBeEnabled();
  expect(posts).toHaveLength(3);
  expect(posts[2].confirm).toBe(true);
  await page.getByRole("button", { name: "Weekend", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    control.getByRole("button", { name: "Continue station experiment" }),
  ).toBeEnabled();
  expect(posts).toHaveLength(3);
  await control
    .getByRole("button", { name: "Continue station experiment" })
    .click();
  await expect(control).toContainText("3 of 3 configurations completed");
  expect(posts.map((value) => [value.configurationId, value.confirm])).toEqual([
    ["baseline", false],
    ["plus-one", false],
    ["plus-one", true],
    ["plus-one", false],
    ["plus-two", false],
  ]);
  const actual = stationPlan(3).result!;
  expect(actual.status).toBe("available");
  if (actual.status === "available" && actual.selected)
    await expect(
      control
        .locator(
          `data[value="${actual.selected.monthlyRevenueChangeUsd.mean}"]`,
        )
        .first(),
    ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a failed write reads the durable progress before an explicit retry and does not repeat baseline", async ({
  page,
}) => {
  await mockLiveSites(page);
  let state = stationPlan(),
    failed = false;
  const posts: string[] = [];
  await page.route("**/station-experiments?*", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/station-experiments", async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body.configurationId);
    if (!failed) {
      failed = true;
      state = stationPlan(1);
      await route.fulfill({ status: 503, json: { message: "Unavailable" } });
      return;
    }
    state = stationPlan(body.configurationId === "plus-one" ? 2 : 3);
    await route.fulfill({ json: state });
  });
  await page.goto(livePath);
  const control = page.getByRole("region", {
    name: "Station experiment",
    exact: true,
  });
  await control
    .getByRole("button", { name: "Run planned station configurations" })
    .click();
  await expect(control.getByRole("alert")).toContainText(
    "Completed work remains recorded",
  );
  await expect(
    control.getByRole("button", { name: "Run planned station configurations" }),
  ).toBeDisabled();
  expect(posts).toEqual(["baseline"]);
  await control
    .getByRole("button", { name: "Refresh station progress" })
    .click();
  await expect(control).toContainText("1 of 3 configurations completed");
  await control
    .getByRole("button", { name: "Continue station experiment" })
    .click();
  await expect(control).toContainText("3 of 3 configurations completed");
  expect(posts).toEqual(["baseline", "plus-one", "plus-two"]);
});

test("unavailable plans and mismatched source responses cannot start configurations", async ({
  page,
}) => {
  await mockLiveSites(page);
  let mismatch = false;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("station-experiments")
    )
      writes.push(request.url());
  });
  await page.route("**/station-experiments?*", (route) => {
    const plan = stationPlan();
    plan.status = "unavailable";
    plan.configurations = [];
    plan.nextConfigurationId = null;
    plan.unavailable = {
      code: "insufficient_seeds",
      reason: "At least two original paired seeds are required.",
    };
    plan.source.currentProfileVersion = null;
    plan.source.outdated = null;
    if (mismatch) plan.source.siteId = "another-site";
    return route.fulfill({ json: plan });
  });
  await page.goto(livePath);
  const control = page.getByRole("region", {
    name: "Station experiment",
    exact: true,
  });
  await expect(control).toContainText("At least two original paired seeds");
  await expect(control).toContainText("Freshness is unknown");
  await expect(
    control.getByRole("button", { name: /Run planned|Continue|Confirm/ }),
  ).toHaveCount(0);
  mismatch = true;
  await control
    .getByRole("button", { name: "Refresh station progress" })
    .click();
  await expect(control.getByRole("alert")).toContainText(
    "could not be verified",
  );
  expect(writes).toEqual([]);
});

test("a blackholed write has a bounded unknown-status recovery and ignores its late response", async ({
  page,
}) => {
  await page.clock.install();
  await mockLiveSites(page);
  let state = stationPlan(),
    release!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    posts: string[] = [];
  await page.route("**/station-experiments?*", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route("**/station-experiments", async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body.configurationId);
    if (posts.length === 1) {
      state = stationPlan(1);
      await held;
      await route.fulfill({ json: stationPlan(1) });
      return;
    }
    state = stationPlan(body.configurationId === "plus-one" ? 2 : 3);
    await route.fulfill({ json: state });
  });
  await page.goto(livePath);
  const control = page.getByRole("region", {
    name: "Station experiment",
    exact: true,
  });
  await control
    .getByRole("button", { name: "Run planned station configurations" })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  await page.clock.fastForward(70001);
  await expect(control.getByRole("alert")).toContainText(
    "status could not be verified",
  );
  await expect(
    control.getByRole("button", { name: "Refresh station progress" }),
  ).toBeEnabled();
  expect(posts).toEqual(["baseline"]);
  await control
    .getByRole("button", { name: "Refresh station progress" })
    .click();
  await expect(control).toContainText("1 of 3 configurations completed");
  await control
    .getByRole("button", { name: "Continue station experiment" })
    .click();
  await expect(control).toContainText("3 of 3 configurations completed");
  release();
  await expect(control).toContainText("3 of 3 configurations completed");
  expect(posts).toEqual(["baseline", "plus-one", "plus-two"]);
});

test("completed no-benefit results show no station recommendation or zero-dollar forecast", async ({
  page,
}) => {
  await mockLiveSites(page);
  const value = stationPlan(3);
  if (value.result?.status === "available") {
    value.result.selected = null;
    value.result.variants = [];
  }
  await page.route("**/station-experiments?*", (route) =>
    route.fulfill({ json: value }),
  );
  await page.goto(livePath);
  const control = page.getByRole("region", {
    name: "Station experiment",
    exact: true,
  });
  await expect(control).toContainText(
    "No tested station alternative adds modeled monthly revenue",
  );
  await expect(
    control.getByRole("region", {
      name: "Station recommendation",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    control.getByRole("button", { name: /Run planned|Continue|Confirm/ }),
  ).toHaveCount(0);
});
