import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  liveComparisonPayload,
  liveComparisonRecord,
  mockLiveComparison,
} from "./live-comparison-fixtures";

const [leader, other] = liveComparisonPayload.result.ranking;
const robustness = {
  headline: `${leader} leads under current assumptions; ${other} leads if demand (market share) falls below 0.70× its current level.`,
  leaderSiteId: leader,
  tiedSiteIds: [],
  mostInfluential: {
    assumption: "market_share_scale",
    breakEven: 0.7,
    unit: "multiplier",
    relativeDistance: 0.3,
    fromSiteId: other,
    toSiteId: leader,
  },
  robustTo: ["rent"],
  jevHuffAgree: false,
  missingInformation: [
    "Your own sales or visitor counts from another location, to calibrate demand.",
  ],
};

test("saved answer leads setup and its action selects and focuses the matching sensitivity without running it", async ({
  page,
}, testInfo) => {
  await mockLiveComparison(page);
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 201,
      json: { ...liveComparisonPayload, robustness },
    }),
  );
  const sensitivityRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/sensitivity"))
      sensitivityRequests.push(request.url());
  });
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const question = page.getByRole("heading", {
    name: "Which site should I choose?",
  });
  const answer = page.getByRole("region", {
    name: "Recommendation robustness",
  });
  const action = page.getByRole("button", {
    name: "Change market share",
    exact: true,
  });
  await expect(answer).toContainText("falls below 0.70×");
  await expect(answer).not.toContainText(leader!);
  await expect(answer).toContainText("disagree on the leader");
  const scene = page.getByRole("region", {
    name: "Decision scene",
    exact: true,
  });
  await expect(scene).toContainText("Stored weekday");
  await expect(scene.getByRole("img")).toHaveAttribute(
    "aria-label",
    /in service/,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(question).toBeInViewport({ ratio: 1 });
  await expect(answer).toBeInViewport({ ratio: 1 });
  await expect(action).toBeInViewport({ ratio: 1 });
  await expect(scene).toBeInViewport({ ratio: 1 });
  await testInfo.attach("desktop-decision", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  const setup = await page
    .getByRole("group", { name: "Sites to compare" })
    .boundingBox();
  expect(setup!.y).toBeGreaterThan((await action.boundingBox())!.y);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await testInfo.attach("mobile-decision", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  console.log(
    "HAC-71 current-shell viewport bounds",
    JSON.stringify({
      width: 375,
      height: 800,
      question: await question.boundingBox(),
      answer: await answer.boundingBox(),
      action: await action.boundingBox(),
    }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(scene).toBeInViewport({ ratio: 1 });
  await expect(action).toBeInViewport({ ratio: 1 });
  await scene.getByLabel("Decision replay time").focus();
  await page.keyboard.press("End");
  await expect(scene.getByRole("img")).toHaveAttribute("aria-label", /served/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Sensitivity assumption")).toHaveValue(
    "market_share_scale",
  );
  await expect(page.getByLabel("Sensitivity assumption")).toBeFocused();
  expect(sensitivityRequests).toEqual([]);
  await page.getByText("Decision evidence", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/The lead holds across/)).toBeVisible();
  await expect(
    page.getByText(/Your own sales or visitor counts/),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("missing robustness offers evidence and never invents a flip condition", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Recommendation robustness" }),
  ).toContainText("unavailable for this saved comparison");
  await page
    .getByRole("link", { name: "Open the evidence", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", {
      name: "Comparison assumptions and findings",
    }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: /^Change / })).toHaveCount(0);
});

test("outdated answers visibly identify the old snapshot and offer an explicit rerun", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 201,
      json: { ...liveComparisonPayload, outdated: true, robustness },
    }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const answer = page.getByRole("region", {
    name: "Recommendation robustness",
  });
  await expect(answer).toContainText("outdated");
  await expect(
    page.getByRole("button", {
      name: "Rerun with current intake",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Change / })).toHaveCount(0);
});

test("the complete next action fits at 375×800", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockLiveComparison(page);
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 201,
      json: { ...liveComparisonPayload, robustness },
    }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  const action = page.getByRole("button", {
    name: "Change market share",
    exact: true,
  });
  await expect(action).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const bounds = await action.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
});

test("invalid stored scene identity fails honestly without substituting another run", async ({
  page,
}) => {
  await mockLiveComparison(page);
  await page.route("**/api/site-runs/*?*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        run: { ...liveComparisonRecord.runs[0], siteId: "different-site" },
      },
    }),
  );
  await page.goto("/projects/houston-coffee/comparison");
  await page
    .getByRole("button", { name: "Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "stored scene is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry scene", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Decision scene", exact: true })
      .getByRole("img"),
  ).toHaveCount(0);
});

test("an explicit simulator sensitivity link selects and focuses the matching control without a model request", async ({
  page,
}) => {
  await mockLiveComparison(page);
  let releaseCandidates!: () => void;
  const candidatesGate = new Promise<void>((resolve) => {
    releaseCandidates = resolve;
  });
  await page.route("**/api/sites", async (route) => {
    await candidatesGate;
    await route.fallback();
  });
  const savedResponse = page.waitForResponse((response) =>
    response
      .url()
      .includes(`/api/comparisons/${liveComparisonPayload.comparisonId}?`),
  );
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(comparisons|sensitivity|profiles)$/.test(
        new URL(request.url()).pathname,
      )
    )
      writes.push(request.url());
  });
  await page.goto(
    `/projects/houston-coffee/comparison?comparison=${liveComparisonPayload.comparisonId}&sensitivity=price#comparison-sensitivity`,
  );
  await (await savedResponse).finished();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading comparison and candidate sites" }),
  ).toBeVisible();
  releaseCandidates();
  await expect(page.getByLabel("Sensitivity assumption")).toHaveValue("price");
  await expect(page.getByLabel("Sensitivity assumption")).toBeFocused();
  expect(writes).toEqual([]);
});

test("decision pages keep all three task groups keyboard reachable in compact navigation", async ({
  page,
}) => {
  for (const route of ["comparison", "simulator"]) {
    await page.goto(`/projects/houston-coffee/${route}`);
    const nav = page.getByRole("navigation", {
      name: "Project views",
      exact: true,
    });
    const summary = nav.locator("summary");
    await expect(summary).toContainText(
      "Find a location · Test the plan · Make the decision",
    );
    await expect(
      nav.getByRole("list", { name: "Tasks", exact: true }),
    ).not.toBeVisible();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      nav.getByRole("list", { name: "Tasks", exact: true }),
    ).toBeVisible();
    await expect(nav.locator('[aria-current="step"]')).toContainText(
      "Test the plan",
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const first = nav.getByRole("link", { name: "Intake", exact: true });
    if (test.info().project.name === "webkit" && process.platform === "darwin")
      await page.keyboard.press("Alt+Tab");
    else await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(
      nav.getByRole("list", { name: "Tasks", exact: true }),
    ).not.toBeVisible();
    await expectNoA11yViolations(page);
  }
});
