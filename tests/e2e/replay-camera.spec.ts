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

/**
 * A screenshot of the canvas once it has been sized by the renderer and has stopped
 * changing. A canvas starts as the 300x150 browser default; a baseline taken before
 * React Three Fiber resizes it never matches later screenshots (HAC-158).
 */
async function settledScreenshot(canvas: Locator) {
  let previous: Buffer | undefined;
  await expect
    .poll(async () => {
      const sized = await canvas.evaluate(
        (element: HTMLCanvasElement) =>
          element.width !== 300 || element.height !== 150,
      );
      const current = await canvas.screenshot();
      const settled = sized && !!previous?.equals(current);
      previous = current;
      return settled;
    })
    .toBe(true);
  return previous!;
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
  const baseline = await settledScreenshot(canvas);

  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const before = await page.evaluate(() => scrollY);
  await screen.swipe(x, y + 60, 0, -160);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(before + 40);
  // Let the swipe's fling finish so scrolling back is not overridden by momentum.
  let last = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => scrollY);
      const stable = now === last;
      last = now;
      return stable;
    })
    .toBe(true);
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
  // Reset works while the camera is on, then Done restores page scrolling. The overlay
  // buttons are part of the canvas screenshot, so the view can only match the baseline
  // once the camera is off. A synthetic tap can be dropped while the page is busy, so
  // Done is tapped only while it is still pressed and the idempotent Reset is repeated
  // until the view is back.
  const reset = floor.getByRole("button", { name: "Reset camera" });
  await screen.tap(reset);
  await expect(async () => {
    if ((await done.getAttribute("aria-pressed")) === "true")
      await screen.tap(done);
    await expect(move).toHaveAttribute("aria-pressed", "false", {
      timeout: 1000,
    });
  }).toPass();
  await expect(async () => {
    if (!(await canvas.screenshot()).equals(baseline)) await screen.tap(reset);
    expect((await canvas.screenshot()).equals(baseline)).toBe(true);
  }).toPass();
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
  // The reset button can render before R3F has sized the canvas and attached
  // OrbitControls. A drag sent during that gap is lost, even though the button
  // and canvas are already visible.
  await expect(canvas).toHaveCSS("touch-action", "none");
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const baseline = await settledScreenshot(canvas);
  const originalCamera = await canvas.getAttribute("data-camera-state");
  expect(originalCamera).toBeTruthy();
  await info.attach("original camera", {
    body: baseline,
    contentType: "image/png",
  });

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 55, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-camera-state", originalCamera!);
  const orbitedCamera = await canvas.getAttribute("data-camera-state");
  const orbited = await canvas.screenshot();
  await info.attach("orbited camera", {
    body: orbited,
    contentType: "image/png",
  });

  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -180);
  await expect(canvas).not.toHaveAttribute("data-camera-state", orbitedCamera!);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await info.attach("zoomed camera", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });

  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(reset).toBeFocused();
  await reset.blur();
  await expect(canvas).toHaveAttribute("data-camera-state", originalCamera!);
});
