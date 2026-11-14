import type { Page } from "@playwright/test";
import { workspaceHref } from "../../lib/client/workspace-routes";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Copy and field order come from components/intake/profile.ts and intake-screen.tsx.
const INITIAL_PROMPT = "What kind of business are you opening? Describe the concept in a sentence or two.";
const ALL_MISSING =
  "Still needed: Business concept, Areas to favor or avoid, Monthly rent ceiling ($), Buildout budget ($), Price tier, Target customers, Opening hours, Staff on shift, Must-haves.";

/** One prompt per missing field, in the order the screen asks for them. */
const ANSWERS = [
  { label: "Business concept", text: "Neighborhood coffee shop", stored: "Neighborhood coffee shop" },
  { label: "Areas to favor or avoid", text: "Favor Montrose", stored: "Favor Montrose" },
  { label: "Monthly rent ceiling ($)", text: "4500", stored: "4500" },
  { label: "Buildout budget ($)", text: "120000", stored: "120000" },
  { label: "Price tier", text: "midrange", stored: "Midrange" },
  { label: "Target customers", text: "Remote workers", stored: "Remote workers" },
  { label: "Opening hours", text: "7am to 5pm", stored: "7am to 5pm" },
  { label: "Staff on shift", text: "2", stored: "2" },
  { label: "Must-haves", text: "Parking nearby", stored: "Parking nearby" },
] as const;

const storageKey = (id: string) => `sitework:intake:v1:${id}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The chat box is labelled "Your answer · <field>"; the profile fields are labelled
// with just the field name (plus a "Default" badge on pre-filled ones).
const chatBox = (page: Page) => page.getByRole("textbox", { name: /^Your answer/ });
const conversation = (page: Page) => page.getByRole("list", { name: "Conversation" });
// The app's own alert; Next.js also renders an empty role="alert" route announcer.
const saveAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "could not save your changes" });
const stillNeeded = (page: Page) => page.getByText(/^Still needed:/);
const profileField = (page: Page, label: string) => page.getByLabel(new RegExp(`^${escapeRegExp(label)}`));

async function openIntake(page: Page) {
  await page.goto(`${workspaceHref("houston-coffee", "intake")}?mode=form`);
  await expect(page.getByRole("heading", { level: 2, name: "Business profile" })).toBeVisible();
}

/** Types an answer into the chat box and submits it with Enter. */
async function answer(page: Page, text: string) {
  const box = chatBox(page);
  await box.fill(text);
  await box.press("Enter");
}

async function answerAll(page: Page, count: number = ANSWERS.length) {
  for (const { text } of ANSWERS.slice(0, count)) await answer(page, text);
}

test.beforeEach(async ({ page, clearIntakeStorage }) => {
  // These specs cover the offline fixture; pin it even where the server has a model (HAC-66).
  await page.route("**/api/projects/*/intake", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { modelConfigured: false } })
      : route.fallback(),
  );
  await clearIntakeStorage();
});

test("first load shows the fixture conversation, the profile panel and the first prompt", async ({ page }) => {
  await openIntake(page);

  await expect(page.getByRole("heading", { level: 2, name: "Intake conversation" })).toBeVisible();
  await expect(page.getByText("This conversation uses a fixture.")).toBeVisible();
  await expect(conversation(page).getByRole("listitem")).toHaveCount(1);
  await expect(conversation(page).getByRole("listitem").first()).toContainText(INITIAL_PROMPT);

  // Category and city arrive pre-filled and are marked as defaults.
  await expect(profileField(page, "Service category")).toHaveValue("Coffee shop");
  await expect(profileField(page, "City")).toHaveValue("Houston");
  await expect(page.getByText("Default", { exact: true })).toHaveCount(2);
  await expect(profileField(page, "Business concept")).toHaveValue("");

  // The first missing field is the next prompt.
  await expect(stillNeeded(page)).toHaveText(ALL_MISSING);
  await expect(page.getByLabel("Your answer · Business concept")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("answering each prompt fills its profile field and moves to the next one", async ({ page }) => {
  await openIntake(page);

  for (const [index, { label, text, stored }] of ANSWERS.entries()) {
    await expect(page.getByLabel(`Your answer · ${label}`)).toBeVisible();
    await answer(page, text);

    await expect(profileField(page, label)).toHaveValue(stored);
    await expect(conversation(page).getByRole("listitem").filter({ hasText: text }).first()).toBeVisible();

    const next = ANSWERS[index + 1];
    if (next) {
      await expect(page.getByLabel(`Your answer · ${next.label}`)).toBeVisible();
      await expect(conversation(page)).toContainText(
        `I saved ${label.toLowerCase()}. Next, enter ${next.label.toLowerCase()}.`,
      );
    }
  }

  // Nothing is missing any more.
  await expect(page.getByText("Your profile is complete")).toBeVisible();
  await expect(page.getByText("All required fields are filled.")).toBeVisible();
  await expect(stillNeeded(page)).toHaveCount(0);
  await expect(chatBox(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
  await expect(conversation(page)).toContainText("Your profile has all the required fields. Review your answers in the form.");
});

test("a rejected chat answer shows a message and keeps asking for the same field", async ({ page }) => {
  await openIntake(page);
  await answerAll(page, 2); // concept, areas -> next is rent

  await answer(page, "-5");
  await expect(conversation(page)).toContainText("Enter a nonnegative whole number.");
  await expect(page.getByLabel("Your answer · Monthly rent ceiling ($)")).toBeVisible();
  await expect(profileField(page, "Monthly rent ceiling ($)")).toHaveValue("");

  await answer(page, "lots");
  await expect(conversation(page).getByText("Enter a nonnegative whole number.")).toHaveCount(2);
  await expect(profileField(page, "Monthly rent ceiling ($)")).toHaveValue("");

  await answer(page, "4500");
  await expect(profileField(page, "Monthly rent ceiling ($)")).toHaveValue("4500");
  await expect(page.getByLabel("Your answer · Buildout budget ($)")).toBeVisible();

  await answer(page, "$120,000");
  await expect(conversation(page).getByText("Enter a nonnegative whole number.")).toHaveCount(3);
  await expect(profileField(page, "Buildout budget ($)")).toHaveValue("");

  await answer(page, "120000");
  await answer(page, "luxury");
  await expect(conversation(page)).toContainText("Choose Budget, Midrange, Premium.");
  await expect(profileField(page, "Price tier")).toHaveValue("");
  await expect(page.getByLabel("Your answer · Price tier")).toBeVisible();
});

test("a zero staff count is rejected with a message", async ({ page }) => {
  await openIntake(page);
  await answerAll(page, 7); // up to opening hours -> next is staff

  await answer(page, "0");
  await expect(conversation(page)).toContainText("Enter a positive whole number.");
  await expect(profileField(page, "Staff on shift")).toHaveValue("");
  await expect(page.getByLabel("Your answer · Staff on shift")).toBeVisible();
});

test("editing a field in the profile panel updates it and the prompt", async ({ page }) => {
  await openIntake(page);

  await profileField(page, "Business concept").fill("Specialty espresso bar");
  await expect(profileField(page, "Business concept")).toHaveValue("Specialty espresso bar");
  await expect(stillNeeded(page)).not.toContainText("Business concept");
  await expect(page.getByLabel("Your answer · Areas to favor or avoid")).toBeVisible();

  await profileField(page, "Price tier").selectOption("Premium");
  await expect(profileField(page, "Price tier")).toHaveValue("Premium");
  await expect(stillNeeded(page)).not.toContainText("Price tier");

  await profileField(page, "Monthly rent ceiling ($)").fill("3000");
  await expect(profileField(page, "Monthly rent ceiling ($)")).toHaveValue("3000");

  // Changing a pre-filled field replaces the default and drops its "Default" badge.
  await profileField(page, "City").selectOption("Los Angeles");
  await expect(profileField(page, "City")).toHaveValue("Los Angeles");
  await expect(page.getByText("Default", { exact: true })).toHaveCount(1);
});

test("invalid values typed in the profile panel show a validation message", async ({ page }) => {
  await openIntake(page);
  await answerAll(page);

  const invalid = [
    { label: "Monthly rent ceiling ($)", value: "-5", message: "Enter a nonnegative whole number." },
    { label: "Buildout budget ($)", value: "1e3", message: "Enter a nonnegative whole number." },
    { label: "Staff on shift", value: "0", message: "Enter a positive whole number." },
  ];
  for (const { label, value, message } of invalid) {
    await profileField(page, label).fill(value);
    await expect(page.getByText(message)).toBeVisible();
    await profileField(page, label).fill("2");
    await expect(page.getByText(message)).toHaveCount(0);
  }
});

test("answers survive a reload", async ({ page }) => {
  await openIntake(page);
  await answerAll(page, 3);
  await profileField(page, "Price tier").selectOption("Budget");
  await expect(page.getByLabel("Your answer · Buildout budget ($)")).toBeVisible();

  await page.reload();

  await expect(profileField(page, "Business concept")).toHaveValue(ANSWERS[0].stored);
  await expect(profileField(page, "Areas to favor or avoid")).toHaveValue(ANSWERS[1].stored);
  await expect(profileField(page, "Monthly rent ceiling ($)")).toHaveValue("4500");
  await expect(profileField(page, "Price tier")).toHaveValue("Budget");
  await expect(page.getByLabel("Your answer · Buildout budget ($)")).toBeVisible();
  // 1 opening prompt + 3 answers + 3 replies
  await expect(conversation(page).getByRole("listitem")).toHaveCount(7);
  await expect(conversation(page)).toContainText(ANSWERS[0].text);

  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey("houston-coffee"));
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!).profile.concept).toEqual({ value: ANSWERS[0].stored, origin: "founder" });
});

test("answers saved under another project id do not leak into this project", async ({ page }) => {
  // Only houston-coffee resolves to a project (other ids render "Project unavailable"),
  // so another project's session is simulated by writing its storage key directly.
  const other = JSON.stringify({
    profile: { concept: { value: "Other project concept", origin: "founder" } },
    messages: [{ role: "agent", text: "Other project prompt" }],
  });
  await openIntake(page);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey("other-project"), other] as const);
  await page.reload();

  await expect(page.getByRole("heading", { level: 2, name: "Business profile" })).toBeVisible();
  await expect(profileField(page, "Business concept")).toHaveValue("");
  await expect(stillNeeded(page)).toHaveText(ALL_MISSING);
  await expect(conversation(page)).toContainText(INITIAL_PROMPT);

  // Saving here writes only this project's key and leaves the other one alone.
  await answer(page, "Houston concept");
  await expect(profileField(page, "Business concept")).toHaveValue("Houston concept");
  const stored = await page.evaluate(
    (keys) => keys.map((key) => localStorage.getItem(key)),
    [storageKey("houston-coffee"), storageKey("other-project")],
  );
  expect(JSON.parse(stored[0]!).profile.concept.value).toBe("Houston concept");
  expect(stored[1]).toBe(other);
});

test("an unknown project id shows no intake form", async ({ page }) => {
  await page.goto(workspaceHref("other-project", "intake"));
  await expect(page.getByRole("heading", { level: 2, name: "Project unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Business profile" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open example project" })).toBeVisible();
});

for (const [name, corrupt] of [
  ["text that is not JSON", "{this is not json"],
  ["JSON that does not match the session schema", JSON.stringify({ profile: { concept: { value: 7 } }, messages: "nope" })],
] as const) {
  test(`a corrupt saved value (${name}) falls back to the initial session`, async ({ page }) => {
    await openIntake(page);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey("houston-coffee"), corrupt] as const);

    await page.reload();

    await expect(page.getByRole("heading", { level: 2, name: "Business profile" })).toBeVisible();
    await expect(conversation(page).getByRole("listitem")).toHaveCount(1);
    await expect(conversation(page)).toContainText(INITIAL_PROMPT);
    await expect(stillNeeded(page)).toHaveText(ALL_MISSING);
    await expect(saveAlert(page)).toHaveCount(0);

    // The screen still works and overwrites the bad value.
    await answer(page, "Recovered concept");
    await expect(profileField(page, "Business concept")).toHaveValue("Recovered concept");
    await page.reload();
    await expect(profileField(page, "Business concept")).toHaveValue("Recovered concept");
  });
}

test("an answer in one tab shows up in another tab", async ({ context, page }) => {
  await openIntake(page);
  const other = await context.newPage();
  await openIntake(other);
  await expect(profileField(other, "Business concept")).toHaveValue("");

  await answer(page, "Synced concept");

  await expect(profileField(other, "Business concept")).toHaveValue("Synced concept");
  await expect(conversation(other)).toContainText("Synced concept");
  await expect(other.getByLabel("Your answer · Areas to favor or avoid")).toBeVisible();

  // And the other way round, through the profile panel.
  await profileField(other, "Areas to favor or avoid").fill("Avoid downtown");
  await expect(profileField(page, "Areas to favor or avoid")).toHaveValue("Avoid downtown");
  await expect(page.getByLabel("Your answer · Monthly rent ceiling ($)")).toBeVisible();
});

test("when localStorage cannot save, an alert appears and the screen keeps working", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
  });
  await openIntake(page);
  await expect(saveAlert(page)).toHaveCount(0);

  await answer(page, "Unsaved concept");

  await expect(saveAlert(page)).toHaveText("This browser could not save your changes.");
  await expect(profileField(page, "Business concept")).toHaveValue("Unsaved concept");
  await expect(conversation(page)).toContainText("Unsaved concept");

  // Still usable: more answers and direct edits go through.
  await answer(page, "Favor Montrose");
  await expect(profileField(page, "Areas to favor or avoid")).toHaveValue("Favor Montrose");
  await expect(page.getByLabel("Your answer · Monthly rent ceiling ($)")).toBeVisible();
  await profileField(page, "Price tier").selectOption("Premium");
  await expect(profileField(page, "Price tier")).toHaveValue("Premium");
  await expect(saveAlert(page)).toHaveCount(1);

  // Nothing was written, so a reload starts fresh.
  await page.reload();
  await expect(profileField(page, "Business concept")).toHaveValue("");
});

test("the whole intake can be completed with the keyboard only", async ({ page, browserName }) => {
  await openIntake(page);
  const box = chatBox(page);

  // Tab from the top of the page until the chat box has focus.
  let focused = false;
  for (let presses = 0; presses < 40 && !focused; presses++) {
    await page.keyboard.press("Tab");
    focused = await box.evaluate((element) => element === document.activeElement);
  }
  expect(focused, "chat box reachable with Tab").toBe(true);

  // Type and press Enter for every prompt; focus stays in the chat box.
  for (const { label, text, stored } of ANSWERS.slice(0, -1)) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await expect(profileField(page, label)).toHaveValue(stored);
    await expect(box).toBeFocused();
  }

  // Submit the last answer from the Send button: Tab to it, then Enter. WebKit skips
  // buttons when tabbing (the macOS "Press Tab to highlight each item" default), so
  // there the answer is submitted with Enter from the chat box instead.
  const last = ANSWERS.at(-1)!;
  await page.keyboard.type(last.text);
  if (browserName !== "webkit") {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Send" })).toBeFocused();
  }
  await page.keyboard.press("Enter");

  await expect(profileField(page, last.label)).toHaveValue(last.stored);
  await expect(page.getByText("Your profile is complete")).toBeVisible();
  await expect(page.getByText("All required fields are filled.")).toBeVisible();
});

test("has no serious or critical accessibility violations", async ({ page }) => {
  await openIntake(page);
  await expectNoA11yViolations(page);

  await answerAll(page);
  await expect(page.getByText("Your profile is complete")).toBeVisible();
  await expectNoA11yViolations(page);
});
