import type { Page, Route } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import {
  closeConsultant,
  expandProjectNavigation,
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

/** Client-side navigation through the project's own links (never page.goto). */
async function navigate(page: Page, label: string, path: RegExp) {
  // On a phone the open sheet covers the page, so the founder closes it to navigate.
  await closeConsultant(page);
  await expandProjectNavigation(page);
  await page
    .getByRole("navigation", { name: "Project views", exact: true })
    .getByRole("link", { name: label, exact: true })
    .click();
  await expect(page).toHaveURL(path);
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
  await openConsultant(page);
  await expect(assistant(page).getByText("Live", { exact: true })).toBeVisible();
  // A marker on window proves every step below is a client navigation, not a reload.
  await page.evaluate(() => {
    (window as unknown as { __shell: number }).__shell = 1;
  });

  // A request is in flight while the founder moves to the map.
  await composer(page).fill("Which block has the most foot traffic?");
  await composer(page).press("Enter");
  await expect.poll(() => pending.length).toBe(1);
  await expect(
    assistant(page).getByRole("button", { name: "Sending message" }),
  ).toBeVisible();

  await navigate(page, "Map", /\/map/);
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

  // An unsent draft and the Voice mode come along to every other route.
  await composer(page).fill("Unsent follow-up");
  for (const [label, path] of [
    ["Site detail", /\/sites\//],
    ["Comparison", /\/comparison/],
    ["Location plan", /\/plan/],
    ["Intake", /\/intake/],
    ["Workspace", /\/workspace/],
  ] as const) {
    await navigate(page, label, path);
    await openConsultant(page);
    await expectOneAssistant(page);
    await expect(composer(page)).toHaveValue("Unsent follow-up");
    await expect(log(page)).toContainText(
      "Westheimer near Montrose has the most foot traffic.",
    );
  }

  await assistant(page).getByRole("tab", { name: "Voice" }).click();
  await navigate(page, "Map", /\/map/);
  await openConsultant(page);
  await expect(
    assistant(page).getByRole("tab", { name: "Voice" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "Voice assistant" }),
  ).toHaveCount(1);
  await assistant(page).getByRole("tab", { name: "Text" }).click();
  await expect(composer(page)).toHaveValue("Unsent follow-up");

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
      `${workspaceHref(projectId, "intake")}?mode=form`,
    ]) {
      await page.goto(path);
      await openConsultant(page);
      await expectOneAssistant(page);
      await expectNoHorizontalOverflow(page);
    }
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
