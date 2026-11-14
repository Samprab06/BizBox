import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** One CDP session for every touch, so Chromium sees each gesture start and end. */
async function touchscreen(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let id = 0;
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number }[],
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({ ...point, id })),
    });
  return {
    /** A real one-finger swipe, so Chromium applies `touch-action` like a phone. */
    async swipe(x: number, y: number, dx: number, dy: number) {
      await touch("touchStart", [{ x, y }]);
      for (let step = 1; step <= 10; step++)
        await touch("touchMove", [
          { x: x + (dx * step) / 10, y: y + (dy * step) / 10 },
        ]);
      await touch("touchEnd", []);
      id++;
    },
    async tap(target: Locator) {
      const box = (await target.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await touch("touchStart", [point]);
      await touch("touchEnd", []);
      id++;
    },
  };
}

// HAC-124: on a phone, a swipe that starts on the canvas scrolls the page; the camera
// moves only after "Move camera" is switched on.
test("replay canvas lets a phone scroll, and moves the camera only on request", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "mobile-chrome",
    "Needs Chromium touch emulation.",
  );
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/projects/houston-coffee/replay?site=montrose");
  const screen = await touchscreen(page);

  const floor = page.getByRole("group", {
    name: "Interactive modeled floor plan",
  });
  const canvas = floor.locator("canvas");
  const move = floor.getByRole("button", { name: "Move camera" });
  await expect(move).toHaveAttribute("aria-pressed", "false");
  await canvas.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const baseline = await canvas.screenshot();

  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const before = await page.evaluate(() => scrollY);
  await screen.swipe(x, y + 60, 0, -160);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(before + 40);
  // The swipe scrolled the page, not the camera: back in place, the view is unchanged.
  await page.evaluate((top) => scrollTo(0, top), before);
  await expect
    .poll(async () => (await canvas.screenshot()).equals(baseline))
    .toBe(true);

  await screen.tap(move);
  const done = floor.getByRole("button", { name: "Done moving camera" });
  await expect(done).toHaveAttribute("aria-pressed", "true");
  const moved = (await canvas.boundingBox())!;
  const scroll = await page.evaluate(() => scrollY);
  await screen.swipe(
    moved.x + moved.width / 2 - 50,
    moved.y + moved.height / 2,
    100,
    0,
  );
  await expect
    .poll(async () => (await canvas.screenshot()).equals(baseline))
    .toBe(false);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);

  // Reset works while the camera is on; turning it off restores page scrolling.
  await screen.tap(floor.getByRole("button", { name: "Reset camera" }));
  await screen.tap(done);
  await expect(move).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(async () => (await canvas.screenshot()).equals(baseline))
    .toBe(true);
});

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
