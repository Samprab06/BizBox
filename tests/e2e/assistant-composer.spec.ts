import type { Page, Route } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, openConsultant, test } from "./fixtures";

// HAC-173: Enter sends, Shift+Enter adds a line, a Thinking state shows while a turn is
// pending, and bold renders. The intake API is mocked: no live model.

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

async function mock(page: Page) {
  const pending: Route[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: true } });
    pending.push(route);
  });
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  return pending;
}

test.beforeEach(async ({ clearIntakeStorage }) => {
  await clearIntakeStorage();
});

test("Shift+Enter adds a line, Enter sends, Thinking shows while pending, bold renders", async ({
  page,
  projectId,
}) => {
  const pending = await mock(page);
  await page.goto(workspaceHref(projectId, "workspace"));
  await openConsultant(page);
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  const box = assistant.getByRole("textbox", { name: "Message the BizBox assistant" });
  const thinking = assistant.getByTestId("assistant-thinking");
  await expect(assistant.getByText("Live", { exact: true })).toBeVisible();

  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.pressSequentially("line two");
  await expect(box).toHaveValue("line one\nline two");
  expect(pending).toHaveLength(0);
  await expect(thinking).toBeEmpty();

  await box.press("Enter");
  await expect.poll(() => pending.length).toBe(1);
  await expect(thinking).toHaveText("Thinking…");
  await expect(thinking).toHaveAttribute("aria-live", "polite");

  await pending[0]!.fulfill({ json: reply("Try **Westheimer** first.") });
  await expect(thinking).toBeEmpty();
  const log = assistant.getByRole("log", { name: "Conversation" });
  await expect(log.locator("strong", { hasText: "Westheimer" })).toBeVisible();
  await expect(log).not.toContainText("**");
});
