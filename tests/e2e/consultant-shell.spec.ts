import type { Page, Route } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import {
  closeConsultant,
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
} from "./fixtures";

// HAC-143: the consultant lives in the project layout, so one conversation (history, draft,
// in-flight request, Text/Voice mode) survives client navigation between every project
// route. Every network boundary is a page.route mock: no model, voice or listing service.

const reply = (assistantMessage: string) => ({
  persisted: false,
  draft: { category: "coffee", city: "Houston" },
  assumptions: {},
  profile: null,
  missingRequiredFields: ["businessName"],
  findings: [],
  questions: [],
  nextQuestion: null,
  defaultSources: [],
  assistantMessage,
});

async function mockServices(page: Page) {
  const pending: Route[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: true } });
    // Scene 1: flow events (e.g. arriving in the workspace) are answered at once; only the
    // founder's messages are held.
    if (route.request().postDataJSON()?.event)
      return route.fulfill({ json: reply("Welcome to your workspace.") });
    pending.push(route);
  });
  await page.route("**/api/voice/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { configured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/sites**", (route) =>
    route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  return { pending };
}

const assistant = (page: Page) =>
  page.getByRole("complementary", { name: "Assistant" });
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the BizBox assistant" });
const log = (page: Page) =>
  assistant(page).getByRole("log", { name: "Conversation" });

/**
 * Client-side navigation through the header stepper, the flow's only navigation (never
 * page.goto). Scene 1: "questions" is the questionnaire, the rest are workspace steps.
 */
async function navigate(page: Page, step: string, path: RegExp) {
  // On a phone the open sheet covers the page, so the founder closes it to navigate.
  await closeConsultant(page);
  await page
    .getByRole("navigation", { name: "Progress" })
    .locator(`[data-flow-step="${step}"] a`)
    .click();
  // A first visit compiles the route in dev, so allow it some time.
  await expect(page).toHaveURL(path, { timeout: 20_000 });
}

/** Unlocks the workspace's first step, as finishing the questionnaire does. */
async function reachLocations(page: Page, projectId: string) {
  await page.evaluate((id) => {
    localStorage.setItem(
      `bizbox:flow:v1:${id}`,
      JSON.stringify({
        reached: ["questions", "locations"],
        siteTweaks: {},
        finalPlan: null,
      }),
    );
  }, projectId);
}

async function expectOneAssistant(page: Page) {
  await expect(assistant(page)).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message the BizBox assistant" }),
  ).toHaveCount(1);
  await expect(page.getByRole("tablist", { name: "Assistant mode" })).toHaveCount(
    1,
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test.beforeEach(async ({ clearIntakeStorage }) => {
  await clearIntakeStorage();
});

test("messages, the draft, an in-flight request and the mode survive navigation", async ({
  page,
  projectId,
}) => {
  test.setTimeout(90_000);
  const { pending } = await mockServices(page);
  await page.goto(workspaceHref(projectId, "workspace"));
  await reachLocations(page, projectId);
  await page.reload();
  await openConsultant(page);
  await expect(assistant(page).getByText("Live", { exact: true })).toBeVisible();
  // A marker on window proves every step below is a client navigation, not a reload.
  await page.evaluate(() => {
    (window as unknown as { __shell: number }).__shell = 1;
  });

  // A request is in flight while the founder goes back to the questionnaire.
  await composer(page).fill("Which block has the most foot traffic?");
  await composer(page).press("Enter");
  await expect.poll(() => pending.length).toBe(1);
  await expect(
    assistant(page).getByRole("button", { name: "Sending message" }),
  ).toBeVisible();

  // Scene 1: the questionnaire shows no dock, but the conversation keeps running.
  await navigate(page, "questions", /\/intake/);
  await expect(assistant(page)).toHaveCount(0);
  await navigate(page, "locations", /\/workspace\?step=locations/);
  await openConsultant(page);
  await expectOneAssistant(page);
  await expect(log(page)).toContainText("Which block has the most foot traffic?");
  // Still busy after navigation: the request was not dropped or re-sent.
  await expect(
    assistant(page).getByRole("button", { name: "Sending message" }),
  ).toBeVisible();
  await pending[0]!.fulfill({
    json: reply("Westheimer near Montrose has the most foot traffic."),
  });
  await expect(log(page)).toContainText(
    "Westheimer near Montrose has the most foot traffic.",
  );
  expect(pending).toHaveLength(1);

  // An unsent draft and the Voice mode come back with the dock.
  await composer(page).fill("Unsent follow-up");
  await assistant(page).getByRole("tab", { name: "Voice" }).click();
  await navigate(page, "questions", /\/intake/);
  await navigate(page, "locations", /\/workspace\?step=locations/);
  await openConsultant(page);
  await expect(assistant(page)).toHaveCount(1);
  await expect(
    assistant(page).getByRole("tab", { name: "Voice" }),
  ).toHaveAttribute("aria-selected", "true");
  await assistant(page).getByRole("tab", { name: "Text" }).click();
  await expect(composer(page)).toHaveValue("Unsent follow-up");
  await expect(log(page)).toContainText(
    "Westheimer near Montrose has the most foot traffic.",
  );

  expect(
    await page.evaluate(
      () => (window as unknown as { __shell?: number }).__shell,
    ),
  ).toBe(1);
});

test("the founder can expand the consultant to full screen and dock it again", async ({
  page,
  projectId,
}) => {
  await mockServices(page);
  await page.goto(workspaceHref(projectId, "workspace"));
  await openConsultant(page);
  const view = page.getByRole("main");
  await expect(view).toBeVisible();

  await assistant(page)
    .getByRole("button", { name: "Expand the assistant" })
    .click();
  await expect(view).toBeHidden();
  await expect(composer(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The layout is kept for the tab, across a reload.
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await expect(view).toBeHidden();

  await assistant(page)
    .getByRole("button", { name: "Show the current step" })
    .click();
  await expect(view).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
});

for (const width of [390, 768, 1280]) {
  test(`no overflow and no axe violations at ${width} px, on every route`, async ({
    page,
    projectId,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await mockServices(page);
    for (const path of [
      workspaceHref(projectId, "workspace"),
      workspaceHref(projectId, "map"),
      workspaceHref(projectId, "comparison"),
      workspaceHref(projectId, "plan"),
    ]) {
      await page.goto(path);
      await openConsultant(page);
      await expectOneAssistant(page);
      await expectNoHorizontalOverflow(page);
    }
    // Scene 1: the questionnaire has no dock at all.
    await page.goto(`${workspaceHref(projectId, "intake")}?mode=form`);
    await expect(page.locator("[data-consultant-layout]")).toHaveAttribute(
      "data-consultant-layout",
      "hidden",
    );
    await expect(assistant(page)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.goto(workspaceHref(projectId, "workspace"));
    await openConsultant(page);
    await expect(
      assistant(page).getByText("Live", { exact: true }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
}

test("keyboard focus moves from the view into the consultant, never back and forth", async ({
  page,
  projectId,
  browserName,
}) => {
  test.skip(browserName === "webkit", "WebKit skips buttons when tabbing");
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockServices(page);
  await page.goto(workspaceHref(projectId, "workspace"));
  await expect(assistant(page).getByText("Live", { exact: true })).toBeVisible();

  const regions: string[] = [];
  for (let presses = 0; presses < 120; presses++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return "none";
      if (active.closest("header")?.parentElement === document.body)
        return "header";
      if (active.closest("main")) return "view";
      if (active.closest('aside[aria-labelledby]')) return "dock";
      return "other";
    });
    if (regions.at(-1) !== where) regions.push(where);
    if (where === "dock" && regions.includes("view")) {
      // Keep going until focus leaves the dock to prove it does not return to the view.
      if (
        await composer(page).evaluate(
          (element) => element === document.activeElement,
        )
      )
        break;
    }
  }
  const firstView = regions.indexOf("view");
  const firstDock = regions.indexOf("dock");
  expect(firstView, `focus order ${regions.join(" > ")}`).toBeGreaterThan(-1);
  expect(firstDock, `focus order ${regions.join(" > ")}`).toBeGreaterThan(
    firstView,
  );
  expect(regions.slice(firstDock)).not.toContain("view");
});
