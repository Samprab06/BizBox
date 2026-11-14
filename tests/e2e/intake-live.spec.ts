import type { Page, Route } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, test } from "./fixtures";

// HAC-66: the intake screen talks to POST /api/projects/[id]/intake when a model is
// configured. Every response here is a page.route mock: no model or database is called.

const origin = (value: number, unit: string, o: "default" | "founder") => ({
  value,
  unit,
  origin: o,
  evidenceIds: [o === "founder" ? "founder:houston-coffee" : "category-default"],
});
const reply = (over: Record<string, unknown> = {}) => ({
  persisted: false,
  draft: { category: "coffee", city: "Houston", concept: "Neighborhood coffee bar" },
  assumptions: { visitsPerMonth: origin(4, "visits/month", "default") },
  profile: null,
  missingRequiredFields: ["businessName", "objective"],
  findings: ["Missing required field: businessName"],
  questions: [],
  nextQuestion: { id: "concept", question: "What is the business name?", fields: [] },
  defaultSources: [],
  assistantMessage: "Great, a neighborhood coffee bar in Houston. What will you call it?",
  ...over,
});

type Call = { state?: unknown; patch?: Record<string, unknown>; message?: string };

test.beforeEach(async ({ clearIntakeStorage }) => {
  await clearIntakeStorage();
});

async function open(page: Page) {
  await page.goto(workspaceHref("houston-coffee", "intake"));
  await expect(page.getByText("Live intake agent. Answers are kept in this browser.")).toBeVisible();
}

async function say(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message the intake agent" });
  await box.fill(text);
  await box.press("Enter");
}

test("a founder message renders the agent reply, draft, assumptions and findings", async ({ page }) => {
  let pending: Route[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { modelConfigured: true } });
    pending.push(route);
  });
  await open(page);
  await say(page, "A neighborhood coffee bar in Houston");
  await expect.poll(() => pending.length).toBe(1);
  const request = pending[0]!.request().postDataJSON() as Call;
  expect(request.message).toBe("A neighborhood coffee bar in Houston");
  await pending[0]!.fulfill({ json: reply() });
  pending = [];

  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation).toContainText("A neighborhood coffee bar in Houston");
  await expect(conversation).toContainText("What will you call it?");
  await expect(page.getByLabel(/^Business concept/)).toHaveValue("Neighborhood coffee bar");
  await expect(page.getByRole("heading", { name: "Assumptions" })).toBeVisible();
  await expect(page.getByText(/Visits per customer per month: 4/)).toBeVisible();
  await expect(page.getByText("Missing required field: businessName")).toBeVisible();
  await expect(page.getByText("Agent still needs: businessName, objective.")).toBeVisible();
});

test("a 503 keeps the conversation, offers a retry and leaves the editor working", async ({ page }) => {
  const calls: Call[] = [];
  let attempt = 0;
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { modelConfigured: true } });
    calls.push(route.request().postDataJSON() as Call);
    attempt += 1;
    if (attempt === 1)
      return route.fulfill({
        status: 503,
        json: { code: "MODEL_RUNTIME_UNAVAILABLE", message: "The intake model runtime could not load. Structured profile edits still work.", field_errors: {} },
      });
    return route.fulfill({ json: reply() });
  });
  await open(page);
  await say(page, "Coffee bar in Houston");

  const alert = page.getByRole("alert").filter({ hasText: "could not load" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("Coffee bar in Houston");

  // The structured editor keeps working while the model is down.
  await page.getByLabel(/^Monthly rent ceiling/).fill("4500");
  await expect(page.getByLabel(/^Monthly rent ceiling/)).toHaveValue("4500");

  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("What will you call it?");
  await expect(alert).toHaveCount(0);
  // The retry resends the same message once, with the pending rent edit as a patch.
  const retried = calls.at(-1)!;
  expect(retried.message).toBe("Coffee bar in Houston");
  expect(retried.patch).toMatchObject({ economics: { monthlyRentCeilingCents: { value: 450000 } } });
  await expect(page.getByRole("list", { name: "Conversation" }).getByText("Coffee bar in Houston", { exact: true })).toHaveCount(1);
});

test("origins change from default to founder as the agent and the editor fill the profile", async ({ page }) => {
  const calls: Call[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { modelConfigured: true } });
    const call = route.request().postDataJSON() as Call;
    calls.push(call);
    if (calls.length === 1) return route.fulfill({ json: reply() });
    // A patch-only sync: no message, so no model; the reply marks the assumption founder.
    return route.fulfill({
      json: reply({
        draft: { ...reply().draft, economics: { monthlyRentCeilingCents: origin(450000, "USD cents/month", "founder") } },
        assumptions: { visitsPerMonth: origin(6, "visits/month", "founder") },
        assistantMessage: "unused",
      }),
    });
  });
  await open(page);
  // Category and city start as defaults.
  await expect(page.getByText("Default", { exact: true })).toHaveCount(2);

  await say(page, "Neighborhood coffee bar in Houston");
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("What will you call it?");
  // The agent's draft confirms category and city as founder answers; the assumption is a default.
  const profile = page.locator("section", { has: page.getByRole("heading", { name: "Business profile" }) });
  await expect(page.getByLabel(/^Service category/)).toHaveValue("Coffee shop");
  await expect(profile.locator("li", { hasText: "Visits per customer per month" })).toContainText("Default");
  await expect(page.getByLabel(/^Service category/).locator("xpath=..")).not.toContainText("Default");

  // A structured edit is sent as a patch when the field is committed, without a message.
  const rent = page.getByLabel(/^Monthly rent ceiling/);
  await rent.fill("4500");
  await rent.blur();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]!.message).toBeUndefined();
  expect(calls[1]!.patch).toEqual({
    economics: { monthlyRentCeilingCents: { value: 450000, unit: "USD cents/month", origin: "founder", evidenceIds: ["browser-intake-rent"] } },
  });
  expect(calls[1]!.state).toMatchObject({ draft: { category: "coffee" } });
  await expect(profile.locator("li", { hasText: "Visits per customer per month" })).toContainText("Founder");
  await expect(page.getByText("Default", { exact: true })).toHaveCount(0);

  // The state survives a reload.
  await page.reload();
  await expect(rent).toHaveValue("4500");
  await expect(profile.locator("li", { hasText: "Visits per customer per month" })).toContainText("6");
});
