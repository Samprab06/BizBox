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
  await expect(map.locator("[data-discovery-map]")).toHaveAttribute(
    "src",
    /houston-discovery/,
  );
  expect(requests.filter((url) => /houston-morning/.test(url))).toEqual([]);
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
  await expect(video).toHaveCSS("object-fit", "contain");
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

test("a morning first mounted while paused plays when the story resumes", async ({
  page,
}) => {
  await page.goto("/");
  await seek(page, 0.301);
  await page.getByRole("button", { name: "Pause story" }).click();
  await seek(page, 0.401);
  const video = page.locator(
    '[data-prepared-media="Recorded neighborhood morning"] video',
  );
  await expect(video).toBeVisible();
  expect(
    await video.evaluate((node) => ({
      paused: (node as HTMLVideoElement).paused,
      time: (node as HTMLVideoElement).currentTime,
    })),
  ).toEqual({ paused: true, time: 0 });
  await page.getByRole("button", { name: "Resume story" }).click();
  await expect
    .poll(() =>
      video.evaluate((node) => (node as HTMLVideoElement).currentTime),
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
  await expect
    .poll(() =>
      video.evaluate((node) => {
        const element = node as HTMLVideoElement;
        return (
          element.readyState >= 2 &&
          Math.abs(element.duration - element.currentTime) < 0.1
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByText("12:00 PM · modeled demand, not measured footfall"),
  ).toBeVisible();
});

test("the location prompt and sent bubble have no blue refraction cutout", async ({
  page,
}) => {
  await page.goto("/");
  await seek(page, 0.241);
  const prompt = page.getByRole("textbox", { name: "Location question" });
  await expect(prompt).toBeVisible();
  await page.getByRole("button", { name: "Pause story" }).click();
  const box = page
    .locator('[class*="questionScene"] [class*="composer"]')
    .first();
  expect(
    await box.evaluate((n) => getComputedStyle(n, "::before").display),
  ).toBe("none");
  await page.getByRole("button", { name: "Send example prompt" }).click();
  const sent = page.locator('[class*="questionScene"] [data-speaker="user"]');
  await expect(sent).toBeVisible();
  expect(
    await sent.evaluate((n) => getComputedStyle(n, "::before").display),
  ).toBe("none");
});

test("portrait map media fits and resumes when rotating to landscape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await seek(page, 0.401);
  const map = page.locator("[data-prepared-map]");
  await expect(map).toHaveAttribute("data-map-framing", "portrait");
  const video = map.locator("video");
  await expect(video.locator("source").first()).toHaveAttribute(
    "src",
    /houston-morning-portrait/,
  );
  await expect
    .poll(() => video.evaluate((n) => (n as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.2);
  const before = await video.evaluate(
    (n) => (n as HTMLVideoElement).currentTime,
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(map).toHaveAttribute("data-map-framing", "landscape");
  await expect(video.locator("source").first()).toHaveAttribute(
    "src",
    /houston-morning\.[a-f0-9]+\.mp4/,
  );
  await expect
    .poll(() => video.evaluate((n) => (n as HTMLVideoElement).currentTime))
    .toBeGreaterThanOrEqual(before);
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "morning",
  );
});
