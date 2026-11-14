import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  // This slice exercises the modeled operating replay, independently of city tiles.
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.route("**/matterport/**", (route) => route.abort());
});

test("paired cafe replay seeks both plans together and resets their counts and selection", async ({
  page,
}) => {
  await page.goto("/simulator-demo#operating-plan");
  const modeled = page.getByRole("button", {
    name: "Modeled layout",
    exact: true,
  });
  if (await modeled.count()) await modeled.click();
  const one = page.getByRole("region", {
    name: "One staffed counter",
    exact: true,
  });
  const two = page.getByRole("region", {
    name: "Two staffed counters",
    exact: true,
  });
  const playback = page.getByRole("region", {
    name: "Shared playback",
    exact: true,
  });
  const seek = playback.getByRole("slider", { name: "Time of day" });
  await expect(one).toBeVisible();
  await expect(two).toBeVisible();
  await seek.focus();
  await seek.press("End");
  await expect(seek).toHaveValue("720");
  const metric = (region: typeof one, label: string) =>
    region
      .getByRole("term")
      .filter({ hasText: label })
      .locator("..")
      .getByRole("definition");
  await expect(metric(one, "Served")).toHaveText("55");
  await expect(metric(two, "Served")).toHaveText("80");
  await expect(metric(one, "Left")).toHaveText("52");
  await expect(metric(two, "Left")).toHaveText("28");
  // The shop replay stops at closing even when a 24-hour neighborhood is present.
  await seek.press("ArrowLeft");
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    playback.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Inspect a customer").selectOption("customer-1");
  await expect(
    one.getByRole("status", { name: "Person inspection" }),
  ).toContainText("customer-1");
  await expect(
    two.getByRole("status", { name: "Person inspection" }),
  ).toContainText("customer-1");
  await page.getByRole("button", { name: "Reset shared playback" }).click();
  await expect(seek).toHaveValue("480");
  await expect(metric(one, "Served")).toHaveText("0");
  await expect(metric(two, "Served")).toHaveText("0");
  await expect(page.getByLabel("Inspect a customer")).toHaveValue("");
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    playback.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await seek.inputValue()))
    .toBeGreaterThan(480);
  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await seek.inputValue();
  await expect(seek).toHaveValue(paused);
  await seek.focus();
  await seek.press("Home");
  await expect(metric(one, "Waiting")).toHaveText("0");
  await expect(metric(two, "Waiting")).toHaveText("0");
});

test("staffing roles can be inspected without relying on dot color at each layout width", async ({
  page,
}) => {
  await page.goto("/simulator-demo#operating-plan");
  const modeled = page.getByRole("button", {
    name: "Modeled layout",
    exact: true,
  });
  if (await modeled.count()) await modeled.click();
  const one = page.getByRole("region", {
    name: "One staffed counter",
    exact: true,
  });
  const two = page.getByRole("region", {
    name: "Two staffed counters",
    exact: true,
  });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      one.getByRole("button", { name: "Inspect employee 1", exact: true }),
    ).toBeVisible();
    await expect(
      one.getByRole("button", { name: "Inspect employee 2", exact: true }),
    ).toHaveCount(0);
    await two
      .getByRole("button", { name: "Inspect employee 2", exact: true })
      .click();
    await expect(
      two.getByRole("status", { name: "Person inspection" }),
    ).toContainText(/Employee 2/i);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
});

test("WebGL-unavailable interior keeps the comparison, staffing and playback usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.includes("webgl")) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/simulator-demo#operating-plan");
  const modeled = page.getByRole("button", {
    name: "Modeled layout",
    exact: true,
  });
  if (await modeled.count()) await modeled.click();
  const one = page.getByRole("region", {
    name: "One staffed counter",
    exact: true,
  });
  await expect(one).toBeVisible();
  await one
    .locator('[aria-label="Modeled block and café"]')
    .scrollIntoViewIfNeeded();
  await expect(one.getByText(/3D requires WebGL/)).toBeVisible();
  await one
    .getByRole("button", { name: "Inspect employee 1", exact: true })
    .click();
  await expect(
    one.getByRole("status", { name: "Person inspection" }),
  ).toContainText(/Employee 1/i);
  const playback = page.getByRole("region", {
    name: "Shared playback",
    exact: true,
  });
  await playback.getByRole("slider", { name: "Time of day" }).focus();
  await playback.getByRole("slider", { name: "Time of day" }).press("End");
  await expect(
    one
      .getByRole("term")
      .filter({ hasText: "Served" })
      .locator("..")
      .getByRole("definition"),
  ).toHaveText("55");
  await page.getByRole("button", { name: "Reset shared playback" }).click();
  await expect(
    playback.getByRole("slider", { name: "Time of day" }),
  ).toHaveValue("480");
});
