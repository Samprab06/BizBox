import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const mediaDiagnostic = process.env.BIZBOX_MEDIA_DIAGNOSTIC === "1";
const forceMediaLoad = process.env.BIZBOX_MEDIA_FORCE_LOAD === "1";
const mediaRequests = new WeakMap<Page, unknown[]>();

test.beforeEach(async ({ page }) => {
  if (!mediaDiagnostic && !forceMediaLoad) return;
  if (mediaDiagnostic) {
    const requests: unknown[] = [];
    mediaRequests.set(page, requests);
    page.on("request", (request) => {
      if (/\.(mp4|webm)(?:\?|$)/.test(request.url()))
        requests.push({
          event: "request",
          url: request.url(),
          range: request.headers().range,
        });
    });
    page.on("response", (response) => {
      if (/\.(mp4|webm)(?:\?|$)/.test(response.url()))
        requests.push({
          event: "response",
          url: response.url(),
          status: response.status(),
        });
    });
    page.on("requestfailed", (request) => {
      if (/\.(mp4|webm)(?:\?|$)/.test(request.url()))
        requests.push({
          event: "requestfailed",
          url: request.url(),
          error: request.failure()?.errorText,
        });
    });
  }
  await page.addInitScript(
    ({ diagnostic, forceLoad }) => {
      const events: unknown[] = [];
      const ids = new WeakMap<HTMLMediaElement, number>();
      const nodes = new Set<HTMLMediaElement>();
      const loaded = new WeakSet<HTMLMediaElement>();
      const snapshot = (element: HTMLMediaElement) => {
        if (!ids.has(element)) ids.set(element, nodes.size + 1);
        nodes.add(element);
        return {
          id: ids.get(element),
          connected: element.isConnected,
          readyState: element.readyState,
          networkState: element.networkState,
          paused: element.paused,
          muted: element.muted,
          defaultMuted: element.defaultMuted,
          currentSrc: element.currentSrc,
          currentTime: element.currentTime,
          visibility: document.visibilityState,
          bounds: element.getBoundingClientRect().toJSON(),
          style: {
            display: getComputedStyle(element).display,
            visibility: getComputedStyle(element).visibility,
            opacity: getComputedStyle(element).opacity,
          },
          storyChapter: document
            .querySelector("[data-story-chapter]")
            ?.getAttribute("data-story-chapter"),
          storyPaused: !!document.querySelector(
            'button[aria-label="Resume story"]',
          ),
          activation: navigator.userActivation && {
            active: navigator.userActivation.isActive,
            seen: navigator.userActivation.hasBeenActive,
          },
          src: element.getAttribute("src"),
          preload: element.preload,
          mutedAttribute: element.hasAttribute("muted"),
          playsInline: element.hasAttribute("playsinline"),
          sources: [...element.querySelectorAll("source")].map((source) => ({
            src: source.getAttribute("src"),
            type: source.type,
          })),
          error: element.error && {
            code: element.error.code,
            message: element.error.message,
          },
        };
      };
      const record = (
        event: string,
        element: HTMLMediaElement,
        detail?: unknown,
      ) => {
        if (diagnostic && events.length < 240)
          events.push({
            event,
            at: Math.round(performance.now()),
            ...snapshot(element),
            detail,
          });
      };
      if (diagnostic) {
        Object.assign(window, {
          __bizboxMediaDiagnostic: {
            events,
            final: () => [...nodes].map(snapshot),
          },
        });
        for (const name of [
          "loadstart",
          "loadedmetadata",
          "loadeddata",
          "durationchange",
          "canplay",
          "canplaythrough",
          "play",
          "playing",
          "pause",
          "waiting",
          "stalled",
          "suspend",
          "abort",
          "emptied",
          "error",
          "ended",
          "seeking",
          "seeked",
          "timeupdate",
        ]) {
          document.addEventListener(
            name,
            (event) => {
              const target = event.target;
              const element =
                target instanceof HTMLMediaElement
                  ? target
                  : target instanceof HTMLSourceElement
                    ? target.parentElement
                    : null;
              if (element instanceof HTMLMediaElement) record(name, element);
            },
            true,
          );
        }
        document.addEventListener(
          "click",
          (event) => {
            if (
              (event.target as Element | null)?.closest?.(
                "[data-play-recording]",
              )
            )
              events.push({
                event: "manual-click",
                at: Math.round(performance.now()),
                activation: navigator.userActivation?.isActive,
                visibility: document.visibilityState,
              });
          },
          true,
        );
      }
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        record("play-call", this);
        if (forceLoad && !loaded.has(this)) {
          loaded.add(this);
          if (this.readyState === 0) {
            record("force-load", this);
            this.load();
          }
        }
        let result: Promise<void>;
        try {
          result = nativePlay.call(this);
        } catch (error) {
          record("play-threw", this, String(error));
          throw error;
        }
        void result.then(
          () => record("play-resolved", this),
          (error: unknown) =>
            record(
              "play-rejected",
              this,
              error instanceof DOMException
                ? { name: error.name, message: error.message }
                : String(error),
            ),
        );
        return result;
      };
    },
    { diagnostic: mediaDiagnostic, forceLoad: forceMediaLoad },
  );
});

test.afterEach(async ({ page }, info) => {
  if (!mediaDiagnostic) return;
  const browser = await page
    .evaluate(() => {
      const diagnostic = (
        window as typeof window & {
          __bizboxMediaDiagnostic?: {
            events: unknown[];
            final: () => unknown[];
          };
        }
      ).__bizboxMediaDiagnostic;
      return (
        diagnostic && { events: diagnostic.events, final: diagnostic.final() }
      );
    })
    .catch((error: unknown) => ({ collectorError: String(error) }));
  const report = {
    project: info.project.name,
    test: info.title,
    forceLoad: forceMediaLoad,
    status: info.status,
    requests: mediaRequests.get(page),
    browser,
  };
  const json = JSON.stringify(report);
  console.log(`BIZBOX_MEDIA_DIAGNOSTIC ${json}`);
  await info.attach("prepared-media-diagnostic", {
    body: json,
    contentType: "application/json",
  });
});

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
