import type { Page } from "@playwright/test";
import { flowStepHref } from "../../lib/client/flow-progress";
import { expect, test } from "./fixtures";

// Actual homepage coverage. Providers and API writes are intercepted before they reach
// the server; these tests never call an imagery, model, voice, or database service.
const PROJECT = "p-0123456789abcdef0123";
const STORAGE_KEY = `sitework:intake:v1:${PROJECT}`;
const CURRENT_PROJECT_KEY = "bizbox:current-project:v1";
const founder = (value: string) => ({ value, origin: "founder" });
const answeredProfile = {
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
};

async function mockServices(page: Page, origin: string) {
  const paths: string[] = [];
  const projectPosts: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // Cesium/OpenFreeMap/Matterport/model providers must never make real requests.
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/projects" && request.method() === "POST") {
      projectPosts.push(request.method());
      return route.fulfill({
        status: 201,
        json: { id: PROJECT, name: "New project" },
      });
    }
    if (/^\/api\/projects\/[^/]+\/intake$/.test(url.pathname))
      return request.method() === "GET"
        ? route.fulfill({ json: { modelConfigured: false } })
        : route.fulfill({
            status: 503,
            json: { message: "Model disabled in entry test" },
          });
    if (url.pathname === "/api/voice/session")
      return route.fulfill({ json: { configured: false } });
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health")
      return route.fulfill({
        status: 503,
        json: { message: "Provider disabled in entry test" },
      });
    return route.fallback();
  });
  return { paths, projectPosts };
}

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "hero",
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Test your business before you commit.",
    }),
  ).toBeVisible();
}

async function finalAction(page: Page) {
  await page.keyboard.press("End");
  await expect(page.locator("[data-story-chapter]")).toHaveAttribute(
    "data-story-chapter",
    "return",
  );
  const action = page.getByRole("link", { name: "Open BizBox", exact: true });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", "/start");
  return action;
}

/** The solid navbar entry, at the top of the page from the first frame. */
function navbarStart(page: Page) {
  return page
    .locator("[data-story-chapter]")
    .getByRole("link", { name: "Get started", exact: true });
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function seedProfile(page: Page, finished: boolean) {
  await page.evaluate(
    ({ key, currentKey, id, profile }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          profile,
          messages: [
            { role: "agent", text: "What kind of business are you opening?" },
          ],
        }),
      );
      localStorage.setItem(currentKey, id);
    },
    {
      key: STORAGE_KEY,
      currentKey: CURRENT_PROJECT_KEY,
      id: PROJECT,
      profile: finished
        ? answeredProfile
        : { concept: answeredProfile.concept },
    },
  );
}

async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(sizes.document, "homepage must fit the viewport").toBeLessThanOrEqual(
    sizes.viewport,
  );
}

test.describe("new BizBox homepage entry", () => {
  let services: Awaited<ReturnType<typeof mockServices>>;
  test.beforeEach(async ({ page, baseURL, clearIntakeStorage }) => {
    services = await mockServices(page, new URL(baseURL!).origin);
    // Seed/clear on a same-origin JSON document, without racing /start redirects.
    await page.goto("/api/health");
    await clearIntakeStorage();
    await page.evaluate(
      (key) => localStorage.removeItem(key),
      CURRENT_PROJECT_KEY,
    );
  });

  test("serves the branded story at / without the legacy script or iframe shell", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openHome(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle(/BizBox/);
    await expect(
      page.getByRole("button", { name: "BizBox home", exact: true }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(
      page.locator('script[src*="/landing-preview/app.js"]'),
    ).toHaveCount(0);
    expect(services.paths).not.toContain("/landing-preview/app.js");
    expect(services.projectPosts).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test("the navbar's Get started button is visible at the top and leads to the questionnaire", async ({
    page,
  }) => {
    await openHome(page);
    const start = navbarStart(page);
    await expect(start).toBeVisible();
    await expect(start).toBeInViewport();
    await expect(start).toHaveAttribute("href", "/start");
    // Solid and high contrast: dark text on a near-white fill, not the glass CTA.
    expect(
      await start.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.backgroundColor, style.color];
      }),
    ).toEqual(["rgb(255, 253, 248)", "rgb(38, 51, 59)"]);
    const box = (await start.boundingBox())!;
    expect(box.y).toBeLessThan(120);
    expect(box.height).toBeGreaterThanOrEqual(40);
    await start.click();
    await expect(page).toHaveURL(
      new RegExp(`${escape(flowStepHref(PROJECT, "questions"))}$`),
    );
    await expect(page.locator("#onboarding-title")).toHaveText(
      "What are you opening?",
    );
    expect(services.projectPosts).toEqual(["POST"]);
  });

  test("keyboard End exposes /start and a first visit creates its own project once", async ({
    page,
  }) => {
    await openHome(page);
    await (await finalAction(page)).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/intake$`));
    await expect(page.locator("#onboarding-title")).toHaveText(
      "What are you opening?",
    );
    expect(services.projectPosts).toEqual(["POST"]);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        CURRENT_PROJECT_KEY,
      ),
    ).toBe(PROJECT);
  });

  test("a partial profile offers its own questions and workspace from /start", async ({
    page,
  }) => {
    await seedProfile(page, false);
    await openHome(page);
    await (await finalAction(page)).click();
    await expect(page).toHaveURL(/\/start$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome back to BizBox" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue the questions" }),
    ).toHaveAttribute("href", flowStepHref(PROJECT, "questions"));
    await expect(
      page.getByRole("link", { name: "Open your workspace" }),
    ).toHaveAttribute("href", flowStepHref(PROJECT, "locations"));
    expect(services.projectPosts).toHaveLength(0);
  });

  test("a finished profile resumes the founder's own top locations rather than the demo", async ({
    page,
  }) => {
    await seedProfile(page, true);
    await openHome(page);
    await (await finalAction(page)).click();
    await expect(page).toHaveURL(
      new RegExp(`${escape(flowStepHref(PROJECT, "locations"))}$`),
    );
    await expect(
      page
        .getByRole("navigation", { name: "Progress" })
        .locator('[aria-current="step"]'),
    ).toContainText("Top locations");
    expect(services.projectPosts).toHaveLength(0);
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    test(`fits the hero, the navbar start button and return CTA at ${viewport.width}px without overflow`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openHome(page);
      await expectNoOverflow(page);
      await expect(navbarStart(page)).toBeInViewport();
      const action = await finalAction(page);
      await expect(action).toBeInViewport();
      await expectNoOverflow(page);
    });
  }

  test("reduced motion reaches the real onboarding review and the /start CTA", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await page
      .getByRole("button", { name: "How it works", exact: true })
      .click();
    const onboarding = page.locator('[data-onboarding-panel="true"]');
    await expect(page.locator('[data-onboarding-ready="true"]')).toBeVisible();
    await expect(onboarding).toHaveAttribute("data-input-step", "review");
    await expect(
      onboarding.getByRole("heading", {
        name: "Your café. Locked in.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(onboarding.locator('[data-locked="true"]')).toContainText(
      "Business brief saved",
    );
    await expect(
      onboarding.getByRole("progressbar", {
        name: "Business setup demonstration",
      }),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(
      onboarding.getByRole("button", { name: "Find a location", exact: true }),
    ).toBeVisible();
    await finalAction(page);
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(services.projectPosts).toHaveLength(0);
  });
});
