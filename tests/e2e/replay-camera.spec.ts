import { expect, test } from "./fixtures";

test("replay camera orbits, zooms, and resets with the keyboard", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Requires desktop Chromium WebGL and a mouse wheel.",
  );
  await page.goto("/projects/houston-coffee/replay?site=montrose");

  const floor = page.getByRole("group", {
    name: "Interactive modeled floor plan",
  });
  const canvas = floor.locator("canvas");
  const reset = floor.getByRole("button", { name: "Reset camera" });
  await expect(reset).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const baseline = await canvas.screenshot();
  await info.attach("original camera", {
    body: baseline,
    contentType: "image/png",
  });

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 55, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(baseline))
    .toBe(false);
  const orbited = await canvas.screenshot();
  await info.attach("orbited camera", {
    body: orbited,
    contentType: "image/png",
  });

  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await canvas.screenshot()).equals(orbited))
    .toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await info.attach("zoomed camera", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });

  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(reset).toBeFocused();
  await reset.blur();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(baseline))
    .toBe(true);
});
