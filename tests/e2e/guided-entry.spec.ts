import type { Page } from "@playwright/test";
import { flowStepHref } from "../../lib/client/flow-progress";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Scene 1 (replaces the HAC-150 chat-first entry): the landing's Get started button and
// /start open the structured questionnaire at /intake; its review step hands off to the
// workspace's Top locations step; the progress stepper in the project header is the only
// back/forth navigation. Every network boundary is mocked: no model, voice, map tile or
// database service is called.

const PROJECT = "p-0123456789abcdef0123";
const STORAGE_KEY = `sitework:intake:v1:${PROJECT}`;
const FLOW_KEY = `bizbox:flow:v1:${PROJECT}`;
const CURRENT_PROJECT_KEY = "bizbox:current-project:v1";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const at = (href: string) => new RegExp(`${escape(href)}$`);

const founder = (value: string) => ({ value, origin: "founder" });
/** A brief the questionnaire's validation accepts, so it resumes at the review step. */
const finishedProfile = {
  category: founder("Quick-service food"),
  concept: founder("Late-night dumpling counter"),
  customers: founder("Students and night-shift workers"),
  city: founder("Houston"),
  areas: founder("Favor Montrose"),
  rent: founder("4500"),
  buildout: founder("120000"),
  price: founder("Midrange"),
  hours: founder("11:00–23:00"),
  staff: founder("3"),
  requirements: founder("None"),
};

const stepper = (page: Page) =>
  page.getByRole("navigation", { name: "Progress" });
const currentStep = (page: Page) =>
  stepper(page).locator('[aria-current="step"]');

async function mockServices(page: Page, origin: string) {
  const projectPosts: string[] = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
        : route.fulfill({ status: 503, json: { message: "not used" } });
    if (url.pathname === "/api/voice/session")
      return route.fulfill({ json: { configured: false } });
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health")
      return route.fulfill({ status: 503, json: { message: "not used" } });
    return route.fallback();
  });
  return projectPosts;
}

async function seed(page: Page, profile: Record<string, unknown> | null) {
  await page.goto("/api/health");
  await page.evaluate(
    ({ key, currentKey, id, profile }) => {
      localStorage.clear();
      if (profile)
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
      profile,
    },
  );
}

const reached = (page: Page) =>
  page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) ?? "{}") as { reached?: string[] })
        .reached ?? [],
    FLOW_KEY,
  );

let projectPosts: string[];
test.beforeEach(async ({ page, baseURL }) => {
  projectPosts = await mockServices(page, new URL(baseURL!).origin);
  await page.goto("/api/health");
  await page.evaluate(() => localStorage.clear());
});

test("first visit: Get started, /start, then the questionnaire with only step 1 open", async ({
  page,
}) => {
  await page.goto("/");
  const start = page
    .locator("[data-story-chapter]")
    .getByRole("link", { name: "Get started", exact: true });
  await expect(start).toBeInViewport();
  await start.click();
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "questions")));
  expect(projectPosts).toEqual(["POST"]);

  // The questionnaire, not a full-screen chat.
  await expect(page.locator("#onboarding-title")).toHaveText(
    "What are you opening?",
  );
  await expect(page.locator('[data-consultant-layout="focus"]')).toHaveCount(0);

  // The stepper: five numbered steps, the first current, the rest locked (not links).
  await expect(stepper(page).getByRole("listitem")).toHaveCount(5);
  await expect(currentStep(page)).toContainText("Your business");
  await expect(
    currentStep(page),
  ).toHaveAttribute("href", flowStepHref(PROJECT, "questions"));
  await expect(stepper(page).getByRole("link")).toHaveCount(1);
  await expect(stepper(page).locator('[aria-disabled="true"]')).toHaveCount(4);

  // The brand goes home, not to the example project.
  await expect(
    page.getByRole("banner").getByRole("link", { name: "BizBox" }),
  ).toHaveAttribute("href", "/");
  // TaskNav is gone from the flow page.
  await expect(
    page.getByRole("navigation", { name: "Project views" }),
  ).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test("the project's entry route redirects to the questionnaire", async ({
  page,
}) => {
  await page.goto(`/projects/${PROJECT}`);
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "questions")));
  await expect(page.locator("#onboarding-title")).toBeVisible();
});

test("the review step's Find my locations unlocks and opens Top locations; the stepper goes back", async ({
  page,
}) => {
  await seed(page, finishedProfile);
  await page.goto(flowStepHref(PROJECT, "questions"));
  await expect(page.locator("#onboarding-title")).toHaveText(
    "Review your business",
  );
  await expect(page.getByRole("link", { name: "Open workspace" })).toHaveCount(
    0,
  );
  const next = page.getByRole("link", { name: "Find my locations" });
  await expect(next).toHaveAttribute("href", flowStepHref(PROJECT, "locations"));
  await next.click();
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "locations")));
  expect(await reached(page)).toEqual(["questions", "locations"]);
  await expect(currentStep(page)).toContainText("Top locations");

  // Back to the questions through the stepper; Top locations stays reachable.
  await stepper(page)
    .getByRole("link", { name: "Your business", exact: true })
    .click();
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "questions")));
  await expect(currentStep(page)).toContainText("Your business");
  await expect(
    stepper(page).getByRole("link", { name: "Top locations", exact: true }),
  ).toHaveAttribute("href", flowStepHref(PROJECT, "locations"));
  // Compare is not reached yet: shown, but not a link.
  await expect(
    stepper(page).getByRole("link", { name: /Compare/ }),
  ).toHaveCount(0);
});

test("a returning founder with a complete brief continues at Top locations", async ({
  page,
}) => {
  await seed(page, finishedProfile);
  await page.goto("/start");
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "locations")));
  expect(await reached(page)).toEqual(["questions", "locations"]);
  expect(projectPosts).toHaveLength(0);
});

test("a started brief offers to continue the questions or open the workspace", async ({
  page,
}) => {
  await seed(page, { concept: finishedProfile.concept });
  await page.goto("/start");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome back to BizBox" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open your workspace" }),
  ).toHaveAttribute("href", flowStepHref(PROJECT, "locations"));
  await page.getByRole("link", { name: "Continue the questions" }).click();
  await expect(page).toHaveURL(at(flowStepHref(PROJECT, "questions")));
  await expect(page.locator("#onboarding-title")).toBeVisible();
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
]) {
  test(`the stepper fits the header at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(flowStepHref(PROJECT, "questions"));
    await expect(currentStep(page)).toBeVisible();
    await expect(currentStep(page)).toBeInViewport();
    const sizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
    const nav = (await stepper(page).boundingBox())!;
    expect(nav.x + nav.width).toBeLessThanOrEqual(viewport.width);
  });
}
