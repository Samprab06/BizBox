import type { Page, Route } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import {
  expect,
  expectNoA11yViolations,
  openConsultant,
  test,
} from "./fixtures";

// HAC-128/HAC-130: the connected BizBox workspace screen. HAC-143: the assistant is the consultant
// shell's dock (a bottom sheet under 768 px, opened with `openConsultant`). Every network boundary
// is a page.route mock: no
// model, voice, listing or database service is called.

const VIEWPORTS = [
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
] as const;

const reply = (assistantMessage: string) => ({
  persisted: false,
  draft: {
    category: "coffee",
    city: "Houston",
    concept: "Neighborhood coffee bar",
  },
  assumptions: {},
  profile: null,
  missingRequiredFields: ["businessName"],
  findings: [],
  questions: [],
  nextQuestion: null,
  defaultSources: [],
  assistantMessage,
});

type Call = {
  url: string;
  body: { state?: unknown; patch?: unknown; message?: string };
};

async function mockServices(page: Page, options: { live?: boolean } = {}) {
  const calls: Call[] = [];
  const pending: Route[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: options.live ?? true } });
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON() as Call["body"],
    });
    pending.push(route);
  });
  await page.route("**/api/voice/session", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { configured: false } })
      : route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/sites", (route) =>
    route.fulfill({ status: 503, json: { message: "not used" } }),
  );
  await page.route("**/api/comparisons/capabilities", (route) =>
    route.fulfill({ json: { jevConfigured: false } }),
  );
  return { calls, pending };
}

const assistant = (page: Page) =>
  page.getByRole("complementary", { name: "Assistant" });
const tab = (page: Page, name: "Text" | "Voice") =>
  assistant(page).getByRole("tab", { name });
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the BizBox assistant" });

async function open(page: Page, projectId: string, consultant = true) {
  await page.goto(workspaceHref(projectId, "workspace"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  if (!consultant) return;
  await openConsultant(page);
  await expect(
    assistant(page).getByText("Live", { exact: true }),
  ).toBeVisible();
  await expect(
    assistant(page).locator('[data-agent-availability="live"]'),
  ).toHaveCount(1);
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

test.beforeEach(async ({ clearIntakeStorage }) => {
  await clearIntakeStorage();
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Text and Voice share the draft and history without fabricated listings", async ({
      page,
      projectId,
    }) => {
      const { calls, pending } = await mockServices(page);
      // The location panel is checked first: on a phone the open sheet covers most of it.
      await open(page, projectId, false);

      // Missing inventory must not present the decorative city photo as a property or map.
      await expect(
        page
          .getByRole("region", { name: "Workspace", exact: true })
          .getByText("Houston", { exact: true }),
      ).toBeVisible();
      const location = page.getByRole("region", {
        name: "Location and interior workspace",
      });
      await expect(location.getByText("Complete your brief")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Montrose storefront" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("City preview · photo, not a map", { exact: true }),
      ).toHaveCount(0);
      await expect(
        location.getByRole("button", {
          name: "Compare locations",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        location.getByRole("button", { name: "Interior", exact: true }),
      ).toBeDisabled();
      await openConsultant(page);
      await expect(
        assistant(page).getByText("Live", { exact: true }),
      ).toBeVisible();

      // A draft survives a round trip through the Voice tab.
      await composer(page).fill("Is parking nearby?");
      await tab(page, "Voice").click();
      await expect(tab(page, "Voice")).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("region", { name: "Voice assistant" }),
      ).toBeVisible();
      await expect(composer(page)).toHaveCount(0);
      await tab(page, "Voice").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(tab(page, "Text")).toBeFocused();
      await expect(tab(page, "Text")).toHaveAttribute("aria-selected", "true");
      await expect(composer(page)).toHaveValue("Is parking nearby?");

      // Sending posts the intake endpoint's real request shape and shows the agent's reply.
      await composer(page).press("Enter");
      await expect.poll(() => pending.length).toBe(1);
      expect(new URL(calls[0]!.url).pathname).toBe(
        `/api/projects/${projectId}/intake`,
      );
      expect(calls[0]!.body.message).toBe("Is parking nearby?");
      await pending[0]!.fulfill({
        json: reply("Street parking is limited near Montrose."),
      });
      const textLog = assistant(page).getByRole("log", {
        name: "Conversation",
      });
      await expect(textLog).toContainText("Is parking nearby?");
      await expect(textLog).toContainText(
        "Street parking is limited near Montrose.",
      );
      await expect(composer(page)).toHaveValue("");

      // Voice shows the same history on demand; Text keeps it; the disclosure stays open.
      await composer(page).fill("Unsent follow-up");
      await tab(page, "Text").focus();
      await page.keyboard.press("End");
      await expect(tab(page, "Voice")).toBeFocused();
      await assistant(page).getByText("Conversation", { exact: true }).click();
      await expect(
        assistant(page).getByRole("log", { name: "Conversation" }),
      ).toContainText("Street parking is limited near Montrose.");
      await tab(page, "Voice").focus();
      await page.keyboard.press("Home");
      await expect(tab(page, "Text")).toBeFocused();
      await expect(composer(page)).toHaveValue("Unsent follow-up");
      // Switching back and forth again keeps the voice history disclosure open.
      await tab(page, "Voice").click();
      await expect(
        assistant(page).getByRole("log", { name: "Conversation" }),
      ).toBeVisible();
      await tab(page, "Text").click();
      await expect(textLog).toContainText(
        "Street parking is limited near Montrose.",
      );
      await expect(location.getByText("Complete your brief")).toBeVisible();

      // Later messages carry the round-tripped intake state, as the intake screen does.
      await composer(page).press("Enter");
      await expect.poll(() => pending.length).toBe(2);
      expect(calls[1]!.body).toMatchObject({
        message: "Unsent follow-up",
        state: { draft: { city: "Houston" } },
      });
      await pending[1]!.fulfill({ json: reply("Noted.") });
      await expect(textLog).toContainText("Noted.");

      await expectNoHorizontalOverflow(page);
      await expectNoA11yViolations(page);
      await tab(page, "Voice").click();
      await expectNoHorizontalOverflow(page);
      await expectNoA11yViolations(page);
    });
  });
}

test("the history is the intake conversation, so the intake screen shows it too", async ({
  page,
  projectId,
}) => {
  const { pending } = await mockServices(page);
  await open(page, projectId);
  await composer(page).fill("We want a corner space");
  await composer(page).press("Enter");
  await expect.poll(() => pending.length).toBe(1);
  await pending[0]!.fulfill({ json: reply("Corner spaces noted.") });
  await expect(
    assistant(page).getByRole("log", { name: "Conversation" }),
  ).toContainText("Corner spaces noted.");

  // The detailed form (?mode=form) shows the conversation; the guided questions do not.
  await page.goto(`${workspaceHref(projectId, "intake")}?mode=form`);
  const intakeLog = page.getByRole("list", { name: "Conversation" });
  await expect(intakeLog).toContainText("We want a corner space");
  await expect(intakeLog).toContainText("Corner spaces noted.");
});

test("offline, nothing is sent, the draft is kept and no reply is invented", async ({
  page,
  projectId,
}) => {
  const { calls } = await mockServices(page, { live: false });
  await page.goto(workspaceHref(projectId, "workspace"));
  await openConsultant(page);
  await expect(
    assistant(page).locator('[data-agent-availability="offline"]'),
  ).toHaveCount(1);
  await composer(page).fill("Hello?");
  await composer(page).press("Enter");
  await expect(assistant(page).getByRole("alert")).toContainText(
    "nothing was sent",
  );
  await expect(composer(page)).toHaveValue("Hello?");
  expect(calls).toHaveLength(0);
  await expect(
    assistant(page).getByRole("log", { name: "Conversation" }),
  ).not.toContainText("Hello?");
});

test("a server error keeps the message and retries it once", async ({
  page,
  projectId,
}) => {
  const { calls, pending } = await mockServices(page);
  await open(page, projectId);
  await composer(page).fill("What is the foot traffic?");
  await composer(page).press("Enter");
  await expect.poll(() => pending.length).toBe(1);
  await pending[0]!.fulfill({
    status: 503,
    json: { message: "Intake is temporarily unavailable." },
  });
  const alert = assistant(page).getByRole("alert");
  await expect(alert).toContainText("Intake is temporarily unavailable.");
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => pending.length).toBe(2);
  expect(calls[1]!.body.message).toBe("What is the foot traffic?");
  await pending[1]!.fulfill({
    json: reply("Foot traffic data is not loaded yet."),
  });
  const log = assistant(page).getByRole("log", { name: "Conversation" });
  await expect(log).toContainText("Foot traffic data is not loaded yet.");
  await expect(
    log.getByText("What is the foot traffic?", { exact: true }),
  ).toHaveCount(1);
});
