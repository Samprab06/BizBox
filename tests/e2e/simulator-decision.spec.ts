import { test, expect, expectNoA11yViolations } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/vexcel/3d/**", (route) =>
    route.fulfill({ status: 503, body: "No test imagery" }),
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { modelConfigured: false } })
      : route.abort(),
  );
});

test("the simulator leads with a qualified computed answer, real scene and next action across widths", async ({
  page,
}, testInfo) => {
  const modelWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(comparisons|sensitivity|profiles)$/.test(
        new URL(request.url()).pathname,
      )
    )
      modelWrites.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/houston-coffee/simulator");
  const decision = page.getByRole("heading", {
    name: "Does a second staffed station pay off?",
    exact: true,
  });
  const answer = page.getByRole("region", {
    name: "Recommendation robustness",
    exact: true,
  });
  const scene = page.getByRole("region", {
    name: "Decision scene",
    exact: true,
  });
  const action = page.getByRole("link", {
    name: "Open assumptions and evidence",
    exact: true,
  });
  await expect(answer).toContainText("seeded example");
  await expect(answer).toContainText("contribution after included costs");
  await expect(answer).toContainText("demand robustness has not been tested");
  await expect(answer).not.toContainText("$");
  await expect(scene.locator("canvas")).toBeVisible();
  for (const width of [1280, 820, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(decision).toBeInViewport({ ratio: 1 });
    await expect(answer).toBeInViewport({ ratio: 1 });
    await expect(scene).toBeInViewport({ ratio: 1 });
    await expect(action).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    console.log(
      "HAC-71 simulator bounds",
      JSON.stringify({
        width,
        answer: await answer.boundingBox(),
        scene: await scene.boundingBox(),
        action: await action.boundingBox(),
      }),
    );
    if (width !== 820)
      await testInfo.attach(`simulator-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
  }
  await scene.getByLabel("Decision replay scenario").selectOption("1");
  await scene.getByLabel("Decision operating replay time").focus();
  await page.keyboard.press("End");
  await expect(scene).toContainText("12:00 PM");
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#simulator-decision-evidence")).toBeFocused();
  expect(modelWrites).toEqual([]);
  await expectNoA11yViolations(page);
});
