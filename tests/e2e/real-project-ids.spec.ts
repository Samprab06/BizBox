import type { Page } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, test } from "./fixtures";
import { liveCatchment, liveSearch, liveSiteId } from "./live-site-fixtures";

// HAC-136: a fresh brief gets its own project. POST /api/projects is mocked (the suite has
// no database); the route handler itself is unit-tested in app/api/projects/handler.test.ts.

const NEW_PROJECT = "p-00112233445566778899";
const storageKey = `sitework:intake:v1:${NEW_PROJECT}`;
/** The shared synthetic search, re-addressed to the new project. */
const forNewProject = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value).replaceAll('"houston-coffee"', `"${NEW_PROJECT}"`),
  ) as T;

const completedBrief = {
  profile: Object.fromEntries(
    Object.entries({
      concept: "Neighborhood coffee",
      category: "Coffee shop",
      city: "Houston",
      areas: "Any",
      rent: "5000",
      buildout: "60000",
      price: "Midrange",
      customers: "Neighbors",
      hours: "7am-7pm",
      staff: "2",
      requirements: "None",
    }).map(([key, value]) => [key, { value, origin: "founder" }]),
  ),
  messages: [],
};

async function mockServices(page: Page) {
  const creates: string[] = [];
  await page.route("**/api/projects", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creates.push(route.request().url());
    return route.fulfill({
      status: 201,
      json: { id: NEW_PROJECT, name: "New project" },
    });
  });
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { modelConfigured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/sites", (route) =>
    route.fulfill({ json: forNewProject(liveSearch) }),
  );
  await page.route("**/api/sites/*/catchment?*", (route) =>
    route.fulfill({ json: forNewProject(liveCatchment) }),
  );
  return creates;
}

test("a fresh brief creates its own project, and map, site and plan load for it", async ({
  page,
}) => {
  const creates = await mockServices(page);

  // A first visit to /start creates one project and opens its questionnaire (Scene 1).
  await page.goto("/start");
  await expect(page).toHaveURL(new RegExp(`/projects/${NEW_PROJECT}/intake$`));
  expect(creates).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("bizbox:current-project:v1"),
    ),
  ).toBe(NEW_PROJECT);
  await expect(
    page.getByRole("heading", { name: "What are you opening?" }),
  ).toBeVisible();

  // The brief completes under the new project's own ID.
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [storageKey, JSON.stringify(completedBrief)],
  );

  // Returning to /start resumes this project rather than creating another: a finished brief
  // continues at its Top locations step.
  await page.goto("/start");
  await expect(page).toHaveURL(
    new RegExp(`/projects/${NEW_PROJECT}/workspace\\?step=locations$`),
  );
  expect(creates).toHaveLength(1);

  // Map: the live search of this brief, addressed to the new project.
  await page.goto(workspaceHref(NEW_PROJECT, "map"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Map" }),
  ).toBeVisible();
  await expect(
    page.getByText("Listings matched to the completed intake on this device."),
  ).toBeVisible();
  await expect(page.getByText("Project unavailable")).toHaveCount(0);

  // Site: the live candidate opens under the new project.
  await page.goto(workspaceHref(NEW_PROJECT, "site", liveSiteId));
  await expect(
    page.getByRole("heading", { level: 1, name: "Site detail" }),
  ).toBeVisible();
  await expect(page.getByText("Project unavailable")).toHaveCount(0);

  // Comparison: no example sites to compare, so it says what to do next instead of failing.
  await page.goto(workspaceHref(NEW_PROJECT, "comparison"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Comparison" }),
  ).toBeVisible();
  await expect(page.getByText("Unable to load this project view")).toHaveCount(
    0,
  );

  // Plan: the page resolves (no saved comparison yet).
  await page.goto(`/projects/${NEW_PROJECT}/plan`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Location plan" }),
  ).toBeVisible();
});

test("when a project cannot be created, /start offers a retry and the example project", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/projects", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts += 1;
    return route.fulfill({
      status: 503,
      json: { code: "PROJECTS_UNAVAILABLE", message: "unavailable" },
    });
  });
  await page.goto("/start");
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be created" }),
  ).toContainText("could not be created");
  await expect(
    page.getByRole("link", { name: "Open the example project" }),
  ).toHaveAttribute("href", workspaceHref("houston-coffee", "intake"));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be created" }),
  ).toBeVisible();
});

test("a malformed project ID still shows the way back", async ({ page }) => {
  await page.goto(workspaceHref("p-not-a-real-id", "map"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
});
