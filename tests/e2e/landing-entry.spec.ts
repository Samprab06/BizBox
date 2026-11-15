import type { Page } from "@playwright/test";
import { flowStepHref } from "../../lib/client/flow-progress";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// The preserved static preview leads into the guided onboarding and
// the workspace. Every network boundary is a page.route mock: no model, voice, map tile,
// Matterport or database service is called.

// HAC-136: /start creates a project for a first visit; POST /api/projects is mocked to this ID.
const NEW_PROJECT = "p-0123456789abcdef0123";
const STORAGE_KEY = `sitework:intake:v1:${NEW_PROJECT}`;
const SIMULATOR_PATH = "/projects/houston-coffee/simulator";

const founder = (value: string) => ({ value, origin: "founder" });
const answeredProfile = {
  profile: {
    concept: founder("Late-night dumpling counter"),
    category: founder("Quick-service food"),
    city: founder("Houston"),
    areas: founder("Favor Montrose"),
    rent: founder("4500"),
    buildout: founder("120000"),
    price: founder("Midrange"),
    customers: founder("Students and night-shift workers"),
    hours: founder("11am – 11pm"),
    staff: founder("3"),
    requirements: founder("Vent hood"),
  },
  messages: [{ role: "agent", text: "What kind of business are you opening?" }],
};

const stubDocument = (title: string) => ({
  contentType: "text/html",
  body: `<!doctype html><title>${title}</title><body style="margin:0;background:#16171c;color:#fff">${title}</body>`,
});

/** Stubs every service the landing, onboarding and workspace could reach. */
async function mockNetwork(page: Page) {
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  await page.route("**/projects/houston-coffee/simulator**", (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill(stubDocument("Simulator stub"))
      : route.fallback(),
  );
  await page.route("**/projects/houston-coffee/replay**", (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill(stubDocument("Replay stub"))
      : route.fallback(),
  );
  await page.route("https://my.matterport.com/**", (route) =>
    route.fulfill(stubDocument("Matterport stub")),
  );
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { modelConfigured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { configured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 201,
          json: { id: NEW_PROJECT, name: "New project" },
        })
      : route.fallback(),
  );
  await page.route("**/api/sites", (route) =>
    route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  return requested;
}

const contentMode = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { bizboxState?: { contentMode?: string } })
        .bizboxState?.contentMode,
  );

/** Opens the legacy preview and waits for WebGL or its fallback to initialize. */
async function openLanding(page: Page) {
  await page.goto("/landing-preview/index.html");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Test business decisions before committing.",
    }),
  ).toBeAttached();
  await page.waitForFunction(
    () =>
      (window as unknown as { bizboxReady?: boolean }).bizboxReady === true ||
      document.body.classList.contains("ready"),
  );
}

/**
 * Saves a finished profile for the next visit. It is written from /api/health, a plain JSON
 * document on the app's origin: seeding from /start raced that page's own redirect into the
 * onboarding (an empty session sends it there), which left a later reload or navigation
 * landing on the intake view or interrupted.
 */
async function saveFinishedProfile(page: Page) {
  await page.goto("/api/health");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [STORAGE_KEY, JSON.stringify(answeredProfile)],
  );
  await page.evaluate(
    (id) => localStorage.setItem("bizbox:current-project:v1", id),
    NEW_PROJECT,
  );
}

/** A brief that is started but not finished: /start offers the choice instead of redirecting. */
async function savePartialProfile(page: Page) {
  await page.goto("/api/health");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [
      STORAGE_KEY,
      JSON.stringify({
        profile: { concept: founder("Late-night dumpling counter") },
        messages: answeredProfile.messages,
      }),
    ],
  );
  await page.evaluate(
    (id) => localStorage.setItem("bizbox:current-project:v1", id),
    NEW_PROJECT,
  );
}

async function goToStage(page: Page, step: number, mode: string) {
  await page.locator(`.progress-nav [data-step="${step}"]`).click();
  await expect.poll(() => contentMode(page), { timeout: 15_000 }).toBe(mode);
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    "document scrollWidth vs viewport width",
  ).toBeLessThanOrEqual(innerWidth);
}

test.beforeEach(async ({ page, clearIntakeStorage }) => {
  await mockNetwork(page);
  await clearIntakeStorage();
});

test.describe("the legacy landing preview", () => {
  test("preserves the BizBox preview and its absolute asset paths", async ({
    page,
  }) => {
    const requested = await mockNetwork(page);
    await openLanding(page);
    await expect(page).toHaveURL(/\/landing-preview\/index\.html$/);
    await expect(page).toHaveTitle(/BizBox/);
    expect(requested).toContain("/landing-preview/index.html");
    // Legacy assets remain absolute while the root homepage evolves independently.
    expect(requested).toContain("/landing-preview/app.js");
    await expect(
      page.getByRole("link", { name: "BizBox home" }),
    ).toHaveAttribute("href", "/");
    await expect(page.locator(".nav-cta")).toHaveAttribute("href", /\/start$/);
    await expect(page.locator("body")).not.toContainText(/sitework/i);
  });

  test("serves landing assets, page metadata and the app icon from /", async ({
    page,
  }) => {
    const failedResponses: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && response.status() < 500) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await openLanding(page);
    expect(failedResponses).toEqual([]);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /service business/,
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /^BizBox/,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://usebizbox.app/landing-preview/assets/product-screen.jpg",
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/icon");
    const icon = await page.request.get("/icon");
    expect(icon.ok()).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/png");
  });

  test("the live map stage uses the simulator route and unloads its frame when scrolled away", async ({
    page,
  }) => {
    await openLanding(page);
    await goToStage(page, 1, "location");
    const frame = page.locator("#app-frame");
    await expect(frame).toHaveAttribute(
      "src",
      new RegExp(`${SIMULATOR_PATH}$`),
    );
    await expect(page.locator("#product-window")).toHaveAttribute(
      "aria-label",
      "BizBox location preview",
    );

    // The Coffee Port tour keeps its reference label and source link.
    await goToStage(page, 2, "tour");
    await expect(page.locator("#tour-source")).toContainText(
      "Matterport demo · The Coffee Port",
    );
    await expect(page.locator("#tour-source")).toHaveAttribute(
      "href",
      /my\.matterport\.com/,
    );
    await expect(frame).not.toHaveAttribute("src", /.*/);

    await goToStage(page, 0, "laptop");
    await expect(page.locator("#tour-frame")).not.toHaveAttribute("src", /.*/);
    await expect(frame).toBeHidden();
  });

  test("leaving the landing tears down its iframes", async ({ page }) => {
    await openLanding(page);
    await goToStage(page, 1, "location");
    await expect(page.locator("#app-frame")).toHaveAttribute(
      "src",
      /simulator/,
    );
    await expect.poll(() => page.frames().length).toBeGreaterThan(1);
    await page.locator(".nav-cta").click();
    await expect(page).toHaveURL(/\/projects\/p-0123456789abcdef0123\/intake$/);
    expect(page.frames()).toHaveLength(1);
  });

  test("keyboard: skip link first, then the brand, then the call-to-action, which Enter follows", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit does not tab to links without a system full-keyboard setting.",
    );
    await openLanding(page);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to the product");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAccessibleName("BizBox home");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/nav-cta/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/p-0123456789abcdef0123\/intake$/);
  });

  test("reduced motion still loads the landing and its call-to-action", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page);
    // Readiness can precede the first frame that publishes reduced-motion state.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { bizboxState?: { reducedMotion?: boolean } })
              .bizboxState?.reducedMotion,
        ),
      )
      .toBe(true);
    await expect(page.locator(".nav-cta")).toBeVisible();
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    test(`fits ${viewport.width}px wide with the call-to-action in view`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openLanding(page);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".nav-cta")).toBeInViewport();
      await page.goto("/start");
      await expect(page).toHaveURL(/\/projects\/p-0123456789abcdef0123\/intake$/);
    });
  }
});

test.describe("landing to onboarding to workspace", () => {
  test("a first visit goes through /start into the questionnaire and its answers resume from the landing", async ({
    page,
  }) => {
    await openLanding(page);
    await page.locator(".nav-cta").click();
    await expect(page).toHaveURL(/\/projects\/p-0123456789abcdef0123\/intake$/);
    // Scene 1: the brief is the structured questionnaire, not a full-screen chat.
    await expect(page.locator('[data-consultant-layout="focus"]')).toHaveCount(0);
    await expect(page.locator("#onboarding-title")).toHaveText(
      "What are you opening?",
    );

    // One answer goes into the existing intake session.
    await page.getByRole("button", { name: "Quick food" }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("#onboarding-title")).toHaveText(
      "Describe your business.",
    );
    await expect
      .poll(async () => {
        const saved = await page.evaluate(
          (key) => localStorage.getItem(key),
          STORAGE_KEY,
        );
        return JSON.parse(saved ?? "{}").profile?.category;
      })
      .toEqual({ value: "Quick-service food", origin: "founder" });

    // Back at the landing, the same call-to-action now offers to continue, without a second store.
    await page.goto("/landing-preview/index.html");
    await page.locator(".nav-cta").click();
    await expect(page).toHaveURL(/\/start$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome back to BizBox" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open your workspace" }),
    ).toHaveAttribute("href", flowStepHref(NEW_PROJECT, "locations"));
    await page.getByRole("link", { name: "Continue the questions" }).click();
    await expect(page).toHaveURL(/\/projects\/p-0123456789abcdef0123\/intake$/);
    await expect(page.locator("#onboarding-title")).toHaveText(
      "Describe your business.",
    );
  });

  test("a started brief offers the questions or the workspace", async ({
    page,
  }) => {
    await savePartialProfile(page);
    await openLanding(page);
    await page.locator(".nav-cta").click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome back to BizBox" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("link", { name: "Open your workspace" }).click();
    await expect(page).toHaveURL(
      /\/projects\/p-0123456789abcdef0123\/workspace\?step=locations$/,
    );
  });

  test("a returning founder with a finished profile continues at Top locations from the call-to-action", async ({
    page,
  }) => {
    await saveFinishedProfile(page);
    await openLanding(page);
    await page.locator(".nav-cta").click();
    await expect(page).toHaveURL(
      /\/projects\/p-0123456789abcdef0123\/workspace\?step=locations$/,
    );
    await expect(
      page
        .getByRole("navigation", { name: "Progress" })
        .locator('[aria-current="step"]'),
    ).toContainText("Top locations");
  });

  test("the landing's final stage leads a returning founder to their own workspace", async ({
    page,
  }) => {
    await saveFinishedProfile(page);
    await openLanding(page);
    await page.locator('.progress-nav [data-step="5"]').click();
    const link = page.getByRole("link", {
      name: "Already started? Open your workspace",
    });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    // HAC-136: the link goes through /start, which knows this device's project; with a
    // finished brief it carries on to the Top locations step by itself.
    await expect(page).toHaveURL(
      /\/projects\/p-0123456789abcdef0123\/workspace\?step=locations$/,
    );
  });

  test("/start is usable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await savePartialProfile(page);
    await page.goto("/start");
    await expect(
      page.getByRole("link", { name: "Open your workspace" }),
    ).toBeInViewport();
    await expectNoHorizontalOverflow(page);
  });
});
