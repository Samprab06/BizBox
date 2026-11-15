import { expect, test } from "./fixtures";

async function seek(page: import("@playwright/test").Page, progress: number) {
  await page.evaluate(
    (value) =>
      window.scrollTo(
        0,
        value * (document.documentElement.scrollHeight - innerHeight),
      ),
    progress,
  );
}

test("landing uses recorded media without loading a live map", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "hero",
  );
  expect(requests.filter((url) => /\/prepared\//.test(url))).toEqual([]);
  await seek(page, 0.301);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "locations",
  );
  const map = page.locator('[data-map-source="prepared-vexcel"]');
  await expect(map).toBeVisible();
  await expect(map.locator("video")).toHaveCount(0);
  await expect(
    map.locator("button[data-selected]").filter({ hasText: "Montrose" }),
  ).toBeVisible();
  await expect(
    map.locator("button[data-selected]").filter({ hasText: "The Heights" }),
  ).toBeVisible();
  await seek(page, 0.401);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "morning",
  );
  const video = map.locator("video");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.1);
  const overlayCoversPin = await map.evaluate((root) => {
    const stats = root
      .querySelector("[data-recorded-stats]")!
      .getBoundingClientRect();
    return [...root.querySelectorAll("[data-site-pin]")].some((pin) => {
      const box = pin.getBoundingClientRect();
      return (
        box.left < stats.right &&
        box.right > stats.left &&
        box.top < stats.bottom &&
        box.bottom > stats.top
      );
    });
  });
  expect(
    overlayCoversPin,
    "morning results must leave both neighborhood flows visible",
  ).toBe(false);
  const source = await video.evaluate(
    (node) => (node as HTMLVideoElement).currentSrc,
  );
  const response = await page.request.head(source);
  expect(response.headers()["cache-control"]).toContain("immutable");
  const range = await page.request.get(source, {
    headers: { Range: "bytes=0-31" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(32);
  await page.getByRole("button", { name: "Pause story" }).click();
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused))
    .toBe(true);
  await page.getByRole("button", { name: "Replay this scene" }).click();
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.1);
  await seek(page, 0.821);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "counters",
  );
  await expect(page.locator('[data-counter-count="1"] video')).toBeVisible();
  await expect(page.locator('[data-counter-count="2"] video')).toBeVisible();
  await page.getByRole("button", { name: "One staffed counter" }).click();
  await expect(
    page.getByRole("button", { name: "One staffed counter" }),
  ).toHaveAttribute("aria-pressed", "true");
  await seek(page, 0.998);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "return",
  );
  await expect(page.locator('[data-counter-count="1"]')).toBeVisible();
  await expect(page.locator('[data-counter-count="2"]')).toHaveCount(0);
  expect(
    requests.filter((url) =>
      /\/cesium\/|\/api\/vexcel|openfreemap|\.pbf(?:\?|$)/i.test(url),
    ),
  ).toEqual([]);
});

test("reduced motion keeps prepared posters without video requests", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await seek(page, 0.401);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "morning",
  );
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Play .*record/i }),
  ).toBeVisible();
  expect(requests.filter((url) => /\.(?:mp4|webm)(?:\?|$)/.test(url))).toEqual(
    [],
  );
});

test("Save Data avoids video until the visitor explicitly plays it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: true }),
    });
  });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await seek(page, 0.401);
  const recording = page.locator(
    '[data-prepared-media="Recorded neighborhood morning"]',
  );
  await expect(recording).toHaveAttribute("data-media-state", "static");
  expect(requests.filter((url) => /\.(mp4|webm)(?:\?|$)/.test(url))).toEqual(
    [],
  );
  await recording.getByRole("button", { name: /Play Recorded/ }).click();
  await expect(recording.locator("video")).toBeVisible();
  await expect
    .poll(() =>
      recording
        .locator("video")
        .evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.1);
});

test("autoplay rejection retains a poster and allows a manual retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let reject = true;
    HTMLMediaElement.prototype.play = function () {
      if (reject) {
        reject = false;
        return Promise.reject(
          new DOMException("Autoplay disabled", "NotAllowedError"),
        );
      }
      return original.call(this);
    };
  });
  await page.goto("/");
  await seek(page, 0.401);
  const recording = page.locator(
    '[data-prepared-media="Recorded neighborhood morning"]',
  );
  await expect(recording).toHaveAttribute("data-media-state", "static");
  await expect(recording.locator("img")).toBeVisible();
  await recording.getByRole("button", { name: /Play Recorded/ }).click();
  await expect
    .poll(() =>
      recording
        .locator("video")
        .evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.1);
});

test("hidden-tab release preserves playback position and completed morning results", async ({
  page,
}) => {
  await page.goto("/");
  await seek(page, 0.401);
  const recording = page.locator(
    '[data-prepared-media="Recorded neighborhood morning"]',
  );
  const video = recording.locator("video");
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.2);
  const before = await video.evaluate(
    (node) => (node as HTMLVideoElement).currentTime,
  );
  const visibility = async (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await visibility(true);
  await expect(video).toHaveCount(0);
  await visibility(false);
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThanOrEqual(before);
  await video.evaluate((node) => {
    const element = node as HTMLVideoElement;
    element.currentTime = element.duration - 0.02;
  });
  await expect(recording).toHaveAttribute("data-media-state", "ended");
  await expect(
    page.getByText("12:00 PM · modeled demand, not measured footfall"),
  ).toBeVisible();
  await visibility(true);
  await expect(video).toHaveCount(0);
  await visibility(false);
  await expect(recording).toHaveAttribute("data-media-state", "ended");
  await expect(
    page.getByText("12:00 PM · modeled demand, not measured footfall"),
  ).toBeVisible();
});
