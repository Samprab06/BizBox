import { expect, test } from "./fixtures";

test("real cafe SDK starts its 3D layer and switches plans without replacing the viewer", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_EXPECT_MATTERPORT !== "1",
    "Requires a configured domain-authorized SDK key and live public model access",
  );
  test.setTimeout(90_000);
  await page.route("**/api/vexcel/**", (route) => route.abort());
  await page.goto("/projects/houston-coffee/simulator#scanned-interior");
  await expect(
    page.getByRole("region", { name: "Interior view controls" }),
  ).toBeInViewport();
  const scan = page.locator('[aria-label="Scanned simulation"]');
  await scan.scrollIntoViewIfNeeded();
  await expect(scan.locator('[data-overlay-status="ready"]')).toBeVisible({
    timeout: 60_000,
  });
  const frame = page.getByTitle("Matterport café interior", { exact: true });
  await expect(frame).toHaveCount(1);
  const originalFrame = await frame.elementHandle();
  const playback = page.getByRole("group", {
    name: "Shared playback",
    exact: true,
  });
  const time = playback.getByRole("slider", { name: "Time of day" });
  const before = await time.inputValue();
  const plans = page.getByRole("radiogroup", { name: "Scanned plan" });
  await plans
    .getByRole("radio", { name: "One staffed counter", exact: true })
    .press("End");
  await expect(
    plans.getByRole("radio", { name: "Two staffed counters", exact: true }),
  ).toBeChecked();
  await expect(scan).toContainText("2 proposed staffed counters");
  await expect(time).toHaveValue(before);
  expect(
    await frame.evaluate(
      (element, original) => element === original,
      originalFrame,
    ),
  ).toBe(true);
  await playback.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => Number(await time.inputValue()))
    .toBeGreaterThan(Number(before));
  await playback.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(scan.locator('[data-overlay-status="ready"]')).toBeVisible();
  await page.getByRole("button", { name: "Reset shared playback" }).click();
  await expect(time).toHaveValue("480");
  await expect(scan.locator('[data-overlay-status="ready"]')).toBeVisible();
  await originalFrame?.dispose();
});
